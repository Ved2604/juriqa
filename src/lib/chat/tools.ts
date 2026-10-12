import { type FunctionDeclaration, Type } from "@google/genai";
import { and, asc, between, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chunks } from "@/lib/db/schema";
import { type ChatDoc, chunkLabel, parseLabel } from "./context";

/** A chunk as returned to the model and kept for citation lookup. */
export type RetrievedChunk = {
  label: string;
  doc: ChatDoc;
  index: number;
  text: string;
  heading: string | null;
  clause: string | null;
  pageStart: number | null;
  pageEnd: number | null;
};

export type ToolResult = {
  /** Sent back to the model as the function response. */
  response: Record<string, unknown>;
  /** Chunks whose text the model has now seen. */
  chunks: RetrievedChunk[];
  label: string;
  ok: boolean;
};

const SEARCH_LIMIT = 8;
const SECTION_LIMIT = 20;

const docArg = {
  type: Type.STRING,
  description: "Optional document label (e.g. D1) to restrict to one document. Omit to cover all documents in the chat.",
};

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "search_document",
    description:
      "Keyword search over the documents. Returns the most relevant passages with their IDs. Matches word variants (terminate/termination). Search again with synonyms or legal terms if results are poor.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Keywords or a short phrase, e.g. 'liability cap' or 'termination for convenience'." },
        document: docArg,
      },
      required: ["query"],
    },
  },
  {
    name: "get_context",
    description:
      "Read the passages immediately before and after a passage ID, to see surrounding text (e.g. a clause that continues, or a definition it depends on).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "Passage ID, e.g. D1-C87." },
        before: { type: Type.INTEGER, description: "Passages to read before (0-3). Default 1." },
        after: { type: Type.INTEGER, description: "Passages to read after (0-3). Default 1." },
      },
      required: ["id"],
    },
  },
  {
    name: "get_section",
    description:
      "Read every passage of a numbered clause or section, e.g. '9' returns 9, 9.1, 9.2 ... Use list_clauses first if you don't know the number.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        number: { type: Type.STRING, description: "Clause or section number, e.g. '9' or '14.2'." },
        document: docArg,
      },
      required: ["number"],
    },
  },
  {
    name: "read_entire_document",
    description:
      "Read every passage of the document(s) and return the ones relevant to the question, with short notes on each part. Slow (10-30 seconds). Use only for summaries, overviews and 'list all / every' questions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: { type: Type.STRING, description: "What to look for while reading, usually the user's question." },
        document: docArg,
      },
      required: ["question"],
    },
  },
  {
    name: "list_clauses",
    description:
      "The document's outline: section headings with their clause numbers and the ID of each section's first passage. Use it to find where a topic lives.",
    parameters: { type: Type.OBJECT, properties: { document: docArg } },
  },
];

const schemas = {
  search_document: z.object({ query: z.string().trim().min(1), document: z.string().optional() }),
  get_context: z.object({
    id: z.string().trim().min(1),
    before: z.coerce.number().int().min(0).max(3).optional(),
    after: z.coerce.number().int().min(0).max(3).optional(),
  }),
  get_section: z.object({ number: z.coerce.string().trim().min(1), document: z.string().optional() }),
  list_clauses: z.object({ document: z.string().optional() }),
};

type ToolName = keyof typeof schemas;

const fail = (label: string, error: string): ToolResult => ({
  response: { error },
  chunks: [],
  label,
  ok: false,
});

/** Run a tool call from the model. Never throws: problems become an error result the model can read. */
export async function runTool(name: string, rawArgs: unknown, docs: ChatDoc[]): Promise<ToolResult> {
  if (!(name in schemas)) {
    return fail(`Unknown tool “${name}”`, `Unknown tool "${name}". Available tools: ${Object.keys(schemas).join(", ")}.`);
  }
  const parsed = schemas[name as ToolName].safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(`Invalid call to ${name}`, `Invalid arguments for ${name}: ${issue.path.join(".") || "input"} ${issue.message}.`);
  }
  const args = parsed.data as Record<string, unknown>;

  const scope = resolveDocs(args.document as string | undefined, docs);
  if (!scope) {
    return fail(`Unknown document “${args.document}”`, `Unknown document "${args.document}". Valid labels: ${docs.map((d) => d.label).join(", ")}.`);
  }

  try {
    switch (name as ToolName) {
      case "search_document":
        return await search(args.query as string, scope);
      case "get_context":
        return await getContext(args.id as string, (args.before as number) ?? 1, (args.after as number) ?? 1, docs);
      case "get_section":
        return await getSection(args.number as string, scope);
      case "list_clauses":
        return await listClauses(scope);
    }
  } catch (e) {
    console.error(`Tool ${name} failed`, e);
    return fail(`${name} failed`, `The ${name} tool failed unexpectedly. Try a different approach.`);
  }
}

function resolveDocs(label: string | undefined, docs: ChatDoc[]): ChatDoc[] | null {
  if (!label) return docs;
  const doc = docs.find((d) => d.label.toLowerCase() === label.trim().toLowerCase());
  return doc ? [doc] : null;
}

const chunkColumns = {
  documentId: chunks.documentId,
  index: chunks.index,
  text: chunks.text,
  heading: chunks.heading,
  clause: chunks.clause,
  pageStart: chunks.pageStart,
  pageEnd: chunks.pageEnd,
};

type ChunkSelect = { documentId: string; index: number; text: string; heading: string | null; clause: string | null; pageStart: number | null; pageEnd: number | null };

function toRetrieved(rows: ChunkSelect[], docs: ChatDoc[]): RetrievedChunk[] {
  return rows.map((r) => {
    const doc = docs.find((d) => d.id === r.documentId)!;
    return { ...r, label: chunkLabel(doc, r.index), doc };
  });
}

export function formatChunks(list: RetrievedChunk[], multiDoc: boolean) {
  return list.map((c) => ({
    id: c.label,
    ...(multiDoc ? { document: c.doc.name } : {}),
    section: c.heading ?? undefined,
    pages: c.pageStart ? (c.pageEnd !== c.pageStart ? `${c.pageStart}-${c.pageEnd}` : `${c.pageStart}`) : undefined,
    text: c.text,
  }));
}

async function search(query: string, scope: ChatDoc[]): Promise<ToolResult> {
  const label = `Searched for “${query}”`;
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((w) => w.length > 1).slice(0, 12);
  const tsQuery = words.join(" | ");
  const phrase = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  // Rank by full-text relevance (any word may match), with a bonus for the exact phrase,
  // which also catches numbers and amounts the stemmer splits up ("AED 100,000").
  const tsq = tsQuery ? sql`to_tsquery('english', ${tsQuery})` : sql`NULL::tsquery`;
  const score = sql<number>`coalesce(ts_rank_cd(${chunks.search}, ${tsq}, 32), 0) + (case when ${chunks.text} ilike ${phrase} then 1 else 0 end)`;
  const rows = await db
    .select(chunkColumns)
    .from(chunks)
    .where(
      and(
        inArray(chunks.documentId, scope.map((d) => d.id)),
        or(sql`${chunks.search} @@ ${tsq}`, sql`${chunks.text} ilike ${phrase}`),
      ),
    )
    .orderBy(desc(score), asc(chunks.index))
    .limit(SEARCH_LIMIT);

  const found = toRetrieved(rows, scope);
  return {
    response: found.length
      ? { results: formatChunks(found, scope.length > 1) }
      : { results: [], note: "No passages matched. Try synonyms, related legal terms, or list_clauses." },
    chunks: found,
    label,
    ok: true,
  };
}

async function getContext(id: string, before: number, after: number, docs: ChatDoc[]): Promise<ToolResult> {
  const target = parseLabel(id, docs);
  if (!target) return fail(`Invalid passage ID “${id}”`, `"${id}" is not a valid passage ID. Use IDs exactly as returned by other tools, e.g. D1-C87.`);
  const rows = await db
    .select(chunkColumns)
    .from(chunks)
    .where(and(eq(chunks.documentId, target.doc.id), between(chunks.index, target.index - before, target.index + after)))
    .orderBy(asc(chunks.index));
  const found = toRetrieved(rows, docs);
  return { response: { results: formatChunks(found, docs.length > 1) }, chunks: found, label: `Read around ${id}`, ok: true };
}

async function getSection(number: string, scope: ChatDoc[]): Promise<ToolResult> {
  const n = number.replace(/^(clause|section|article)\s+/i, "").replace(/\.$/, "");
  const label = `Read clause ${n}`;
  const headingPattern = `^\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([.\\s]|$)`;
  const rows = await db
    .select(chunkColumns)
    .from(chunks)
    .where(
      and(
        inArray(chunks.documentId, scope.map((d) => d.id)),
        or(eq(chunks.clause, n), sql`${chunks.clause} like ${n + ".%"}`, sql`${chunks.heading} ~* ${headingPattern}`),
      ),
    )
    .orderBy(asc(chunks.documentId), asc(chunks.index))
    .limit(SECTION_LIMIT);
  const found = toRetrieved(rows, scope);
  return {
    response: found.length
      ? { results: formatChunks(found, scope.length > 1), ...(found.length === SECTION_LIMIT ? { note: "Section truncated; use get_context on the last ID to continue." } : {}) }
      : { results: [], note: `No clause numbered "${n}" was found. Use list_clauses to see the available numbers.` },
    chunks: found,
    label,
    ok: true,
  };
}

async function listClauses(scope: ChatDoc[]): Promise<ToolResult> {
  const rows = await db
    .select({ documentId: chunks.documentId, index: chunks.index, heading: chunks.heading, clause: chunks.clause })
    .from(chunks)
    .where(inArray(chunks.documentId, scope.map((d) => d.id)))
    .orderBy(asc(chunks.documentId), asc(chunks.index));

  const outline: { document?: string; heading: string; startsAt: string; clauses?: string }[] = [];
  let last: (typeof outline)[number] | undefined;
  let clauses: string[] = [];
  const close = () => {
    if (last && clauses.length) last.clauses = clauses.length > 1 ? `${clauses[0]} … ${clauses[clauses.length - 1]}` : clauses[0];
  };
  for (const r of rows) {
    const doc = scope.find((d) => d.id === r.documentId)!;
    const heading = r.heading ?? "(untitled)";
    if (!last || last.heading !== heading || last.document !== (scope.length > 1 ? doc.name : undefined)) {
      close();
      last = { ...(scope.length > 1 ? { document: doc.name } : {}), heading, startsAt: chunkLabel(doc, r.index) };
      outline.push(last);
      clauses = [];
    }
    if (r.clause) clauses.push(r.clause);
  }
  close();
  // The outline shows headings, not passage text, so it does not count as reading any chunk.
  return {
    response: {
      outline,
      note: "Headings only. Read a section with get_section or get_context before citing it; outline IDs cannot be cited.",
    },
    chunks: [],
    label: "Reviewed the table of contents",
    ok: true,
  };
}
