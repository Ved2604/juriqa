import { ThinkingLevel, Type } from "@google/genai";
import { asc, inArray } from "drizzle-orm";
import { gemini } from "@/lib/ai/gemini";
import { withRetry } from "@/lib/ai/retry";
import { db } from "@/lib/db";
import { chunks } from "@/lib/db/schema";
import { type ChatDoc, chunkLabel } from "./context";
import type { ChatEvent } from "./events";
import type { RetrievedChunk } from "./tools";

/** Words per batch (~13k tokens): a 150-page contract becomes about 6 batches. */
const BATCH_WORDS = 10_000;
const CONCURRENCY = 4;
/** Most relevant passages kept from each batch, so the final answer prompt stays bounded. */
const MAX_PER_BATCH = 8;

type Batch = { doc: ChatDoc; items: RetrievedChunk[]; pageFrom: number | null; pageTo: number | null };

export type ScanResult = {
  /** Passages judged relevant; their text goes to the model, so they can be cited. */
  relevant: RetrievedChunk[];
  /** Short per-batch notes on what each part says about the question (not citable). */
  notes: string[];
  /** Every chunk in a batch that was read successfully. */
  read: RetrievedChunk[];
  failedPages: Map<string, number[]>;
  failedBatches: number;
};

const SYSTEM = `You screen part of a legal document for passages relevant to a question.
Return the IDs of passages that answer, define, qualify, limit or contradict the answer, at most ${MAX_PER_BATCH}, most important first.
Also write one or two sentences of notes on what this part says about the question, or "Nothing relevant." if none.
Only use IDs that appear in the passages below. Never invent IDs. Use only the text given.`;

/** Read every passage of the given documents, in parallel batches, streaming progress. */
export async function* fullScan(opts: {
  question: string;
  docs: ChatDoc[];
  signal: AbortSignal;
}): AsyncGenerator<ChatEvent, ScanResult> {
  const { question, docs, signal } = opts;
  const batches = await buildBatches(docs);
  const result: ScanResult = { relevant: [], notes: [], read: [], failedPages: new Map(), failedBatches: 0 };

  yield { type: "status", text: `Reading the full document (0 of ${batches.length} parts)` };

  // Run batches with limited concurrency, yielding progress as each finishes.
  const pending = new Map<number, Promise<{ i: number; out: BatchOutcome }>>();
  let next = 0;
  let done = 0;
  const launch = () => {
    const i = next++;
    pending.set(i, screenWithRetry(question, batches[i], signal).then((out) => ({ i, out })));
  };
  while (next < Math.min(CONCURRENCY, batches.length)) launch();

  while (pending.size) {
    const { i, out } = await Promise.race(pending.values());
    pending.delete(i);
    if (next < batches.length) launch();
    done++;

    const batch = batches[i];
    const where = describe(batch, docs.length > 1);
    if (out.ok) {
      result.read.push(...batch.items);
      const picked = batch.items.filter((c) => out.ids.includes(c.label));
      result.relevant.push(...picked);
      if (out.notes && !/^nothing relevant/i.test(out.notes.trim())) result.notes.push(`${where}: ${out.notes}`);
      yield {
        type: "trace",
        step: { tool: "full_scan", label: `Read ${where}`, ok: true, resultCount: picked.length },
      };
    } else {
      result.failedBatches++;
      const pages = pageRange(batch);
      result.failedPages.set(batch.doc.id, [...(result.failedPages.get(batch.doc.id) ?? []), ...pages]);
      yield { type: "trace", step: { tool: "full_scan", label: `Could not read ${where}`, ok: false } };
    }
    yield { type: "status", text: `Reading the full document (${done} of ${batches.length} parts)` };
  }

  // Keep document order so the final answer reads naturally.
  result.relevant.sort((a, b) => a.doc.label.localeCompare(b.doc.label) || a.index - b.index);
  return result;
}

async function buildBatches(docs: ChatDoc[]): Promise<Batch[]> {
  const rows = await db
    .select({
      documentId: chunks.documentId,
      index: chunks.index,
      text: chunks.text,
      heading: chunks.heading,
      clause: chunks.clause,
      pageStart: chunks.pageStart,
      pageEnd: chunks.pageEnd,
      wordCount: chunks.wordCount,
    })
    .from(chunks)
    .where(inArray(chunks.documentId, docs.map((d) => d.id)))
    .orderBy(asc(chunks.documentId), asc(chunks.index));

  const batches: Batch[] = [];
  for (const doc of docs) {
    let current: Batch | null = null;
    let words = 0;
    for (const r of rows.filter((x) => x.documentId === doc.id)) {
      if (!current || words + r.wordCount > BATCH_WORDS) {
        current = { doc, items: [], pageFrom: null, pageTo: null };
        batches.push(current);
        words = 0;
      }
      current.items.push({ ...r, doc, label: chunkLabel(doc, r.index) });
      words += r.wordCount;
      if (r.pageStart) current.pageFrom ??= r.pageStart;
      if (r.pageEnd) current.pageTo = r.pageEnd;
    }
  }
  return batches;
}

type BatchOutcome = { ok: true; ids: string[]; notes: string } | { ok: false };

/** withRetry handles overload; one extra attempt covers malformed JSON or a transient failure. */
async function screenWithRetry(question: string, batch: Batch, signal: AbortSignal): Promise<BatchOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) return { ok: false };
    try {
      return await screen(question, batch, signal);
    } catch (e) {
      if (signal.aborted) return { ok: false };
      console.warn(`Scan batch failed (attempt ${attempt + 1})`, e);
    }
  }
  return { ok: false };
}

async function screen(question: string, batch: Batch, signal: AbortSignal): Promise<BatchOutcome> {
  const passages = batch.items
    .map((c) => `[${c.label}]${c.heading ? ` (${c.heading})` : ""}\n${c.text}`)
    .join("\n\n");
  const res = await withRetry(
    (model) =>
      gemini().models.generateContent({
        model,
        contents: `Question: ${question}\n\nPassages from "${batch.doc.name}":\n\n${passages}`,
        config: {
          systemInstruction: SYSTEM,
          abortSignal: signal,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              relevant: { type: Type.ARRAY, items: { type: Type.STRING } },
              notes: { type: Type.STRING },
            },
            required: ["relevant", "notes"],
          },
        },
      }),
    signal,
  );
  const parsed = JSON.parse(res.text ?? "") as { relevant?: unknown; notes?: unknown };
  const valid = new Set(batch.items.map((c) => c.label));
  // Drop any ID the model invented or took from outside this batch.
  const ids = (Array.isArray(parsed.relevant) ? parsed.relevant : [])
    .filter((id): id is string => typeof id === "string" && valid.has(id.trim()))
    .map((id) => id.trim())
    .slice(0, MAX_PER_BATCH);
  return { ok: true, ids, notes: typeof parsed.notes === "string" ? parsed.notes : "" };
}

function pageRange(batch: Batch): number[] {
  if (!batch.pageFrom || !batch.pageTo) return [];
  return Array.from({ length: batch.pageTo - batch.pageFrom + 1 }, (_, i) => batch.pageFrom! + i);
}

function describe(batch: Batch, multiDoc: boolean): string {
  const prefix = multiDoc ? `${batch.doc.name}, ` : "";
  if (batch.pageFrom && batch.pageTo) {
    return `${prefix}${batch.pageFrom === batch.pageTo ? `page ${batch.pageFrom}` : `pages ${batch.pageFrom}–${batch.pageTo}`}`;
  }
  const first = batch.items[0].index;
  const last = batch.items[batch.items.length - 1].index;
  return `${prefix}passages ${first + 1}–${last + 1}`;
}
