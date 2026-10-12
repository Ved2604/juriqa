import { type Content, FunctionCallingConfigMode, type Part, ThinkingLevel } from "@google/genai";
import { gemini } from "@/lib/ai/gemini";
import { withRetry } from "@/lib/ai/retry";
import type { Finding, TraceStep } from "@/lib/db/schema";
import { formatPages } from "@/lib/pages";
import type { ChatDoc } from "./context";
import { type ChatEvent, citedIds } from "./events";
import { FINAL_ROUND_NOTE, MALFORMED_CALL_NOTE, MAX_ROUNDS, agentSystemPrompt, prescanNote, safetyNetNote } from "./prompts";
import { type ScanResult, fullScan } from "./scan";
import { type RetrievedChunk, formatChunks, runTool, toolDeclarations } from "./tools";

/** Mutable state the caller reads to persist the answer, including after a stop. */
export type AgentState = {
  text: string;
  finding: Finding | null;
  trace: TraceStep[];
  /** Chunks whose text the model has seen; only these may be cited. */
  retrieved: Map<string, RetrievedChunk>;
  /** Every chunk read for this answer, including full-scan batches (coverage). */
  read: Map<string, RetrievedChunk>;
  /** Documents a full scan was run on. */
  scanned: Set<string>;
  /** Pages a full scan could not read, by document id. */
  failedPages: Map<string, number[]>;
};

export const newAgentState = (): AgentState => ({
  text: "",
  finding: null,
  trace: [],
  retrieved: new Map(),
  read: new Map(),
  scanned: new Set(),
  failedPages: new Map(),
});

export type HistoryMessage = { role: "user" | "assistant"; content: string };

function statusLabel(name: string, args: Record<string, unknown> | undefined): string {
  switch (name) {
    case "search_document":
      return `Searching for “${args?.query ?? ""}”`;
    case "get_context":
      return `Reading around ${args?.id ?? "a passage"}`;
    case "get_section":
      return `Reading clause ${args?.number ?? ""}`;
    case "list_clauses":
      return "Reviewing the table of contents";
    case "read_entire_document":
      return "Reading the full document";
    default:
      return `Calling ${name}`;
  }
}

export async function* runAgent(opts: {
  question: string;
  history: HistoryMessage[];
  docs: ChatDoc[];
  signal: AbortSignal;
  state: AgentState;
  /** Read the whole document before researching (summaries, "list all" questions). */
  fullDocument?: boolean;
}): AsyncGenerator<ChatEvent> {
  const { question, history, docs, signal, state } = opts;
  const system = agentSystemPrompt(docs);

  const contents: Content[] = history
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }));
  const step = (s: TraceStep): ChatEvent => {
    state.trace.push(s);
    return { type: "trace", step: s };
  };

  if (opts.fullDocument) {
    // Enforced in code: a summary built from a few search hits would misrepresent the document.
    yield step({ tool: "full_scan", label: "This question needs the whole document, so reading all of it", ok: true });
    const scan = yield* fullScan({ question, docs, signal });
    applyScan(scan, docs, state);
    contents.push({
      role: "user",
      parts: [{ text: `${question}

${prescanNote(JSON.stringify(scanResponse(scan, docs)))}` }],
    });
  } else {
    contents.push({ role: "user", parts: [{ text: question }] });
  }

  yield { type: "status", text: "Planning research" };

  let safetyNetUsed = false;
  let forceAnswer = false;

  for (let round = 0; round < MAX_ROUNDS + 1; round++) {
    const finalRound = forceAnswer || round >= MAX_ROUNDS - 1;
    if (finalRound && !forceAnswer) contents[contents.length - 1].parts!.push({ text: FINAL_ROUND_NOTE });

    const out = yield* streamRound(contents, system, finalRound, signal, state);
    const calls = out.parts.filter((p) => p.functionCall);

    if (calls.length && !finalRound) {
      if (out.text) {
        // Text before a tool call is the model thinking aloud, not the answer.
        state.text = "";
        yield { type: "reset_text" };
      }
      // Send the model's parts back unchanged: they carry thought signatures Gemini requires.
      contents.push({ role: "model", parts: out.parts });

      const responses: Part[] = [];
      for (const { functionCall } of calls) {
        const name = functionCall!.name ?? "";
        const args = functionCall!.args as Record<string, unknown> | undefined;
        yield { type: "status", text: statusLabel(name, args) };

        let response: Record<string, unknown>;
        if (name === "read_entire_document") {
          const scope = pickDocs(args?.document, docs);
          const question = typeof args?.question === "string" && args.question.trim() ? args.question : opts.question;
          if (!scope) {
            response = { error: `Unknown document "${args?.document}". Valid labels: ${docs.map((d) => d.label).join(", ")}.` };
            yield step({ tool: name, label: `Invalid call to ${name}`, ok: false });
          } else {
            const scan = yield* fullScan({ question, docs: scope, signal });
            applyScan(scan, scope, state);
            response = scanResponse(scan, scope);
          }
        } else {
          const result = await runTool(name, args, docs);
          for (const c of result.chunks) {
            state.retrieved.set(c.label, c);
            state.read.set(c.label, c);
          }
          response = result.response;
          yield step({ tool: name, label: result.label, ok: result.ok, resultCount: result.chunks.length });
        }
        responses.push({ functionResponse: { id: functionCall!.id, name, response } });
      }
      contents.push({ role: "user", parts: responses });
      yield { type: "status", text: "Reviewing what I found" };
      continue;
    }

    if (out.text.trim()) {
      state.finding = parseFinding(out.tag) ?? (citedIds(state.text).length ? "found" : "not_found");

      // Safety net: never let "not found" stand unless every passage was read.
      const unread = docs.filter((d) => !state.scanned.has(d.id) && !fullyRead(d, state));
      if (state.finding !== "found" && !safetyNetUsed && unread.length) {
        safetyNetUsed = true;
        forceAnswer = true;
        state.text = "";
        yield { type: "reset_text" };
        yield step({ tool: "safety_net", label: "Searches did not settle it, so reading the full document", ok: true });
        const scan = yield* fullScan({ question, docs: unread, signal });
        applyScan(scan, unread, state);
        contents.push({ role: "model", parts: out.parts });
        contents.push({ role: "user", parts: [{ text: safetyNetNote(JSON.stringify(scanResponse(scan, unread))) }] });
        yield { type: "status", text: "Writing the answer from the full review" };
        continue;
      }
      return;
    }

    // No answer and no usable tool call: typically a malformed function call.
    yield step({ tool: "invalid", label: "Malformed tool call (ignored)", ok: false });
    if (finalRound) break;
    if (out.parts.length) contents.push({ role: "model", parts: out.parts });
    contents.push({ role: "user", parts: [{ text: MALFORMED_CALL_NOTE }] });
  }

  throw new Error("The model did not produce an answer.");
}

/** Stream one model turn. Visible text is emitted as it arrives; the FINDING line is held back. */
async function* streamRound(
  contents: Content[],
  system: string,
  finalRound: boolean,
  signal: AbortSignal,
  state: AgentState,
): AsyncGenerator<ChatEvent, { parts: Part[]; text: string; tag: string }> {
  const stream = await withRetry(
    (model) =>
      gemini().models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: system,
          tools: [{ functionDeclarations: toolDeclarations }],
          toolConfig: finalRound ? { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } : undefined,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: signal,
        },
      }),
    signal,
  );

  const parts: Part[] = [];
  const filter = new FindingFilter();
  state.text = "";
  for await (const chunk of stream) {
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      parts.push(part);
      if (part.text && !part.thought) {
        const visible = filter.push(part.text);
        if (visible) {
          state.text += visible;
          yield { type: "text", delta: visible };
        }
      }
    }
  }
  const rest = filter.flush();
  if (rest) {
    state.text += rest;
    yield { type: "text", delta: rest };
  }
  state.text = state.text.trimEnd();
  return { parts, text: state.text, tag: filter.tag };
}

const MARKER = "FINDING:";

/**
 * Passes streamed text through, but withholds the trailing "FINDING: ..." line
 * so the user never sees it. Holds back any suffix that could be the start of the marker.
 */
class FindingFilter {
  private pending = "";
  tag = "";
  private captured = false;

  push(delta: string): string {
    if (this.captured) {
      this.tag += delta;
      return "";
    }
    const text = this.pending + delta;
    const idx = text.toUpperCase().indexOf(MARKER);
    if (idx >= 0) {
      this.captured = true;
      this.tag = text.slice(idx + MARKER.length);
      this.pending = "";
      return text.slice(0, idx).replace(/[\s*_]+$/, "");
    }
    let hold = 0;
    for (let n = Math.min(MARKER.length - 1, text.length); n > 0; n--) {
      if (MARKER.startsWith(text.slice(-n).toUpperCase())) {
        hold = n;
        break;
      }
    }
    this.pending = text.slice(text.length - hold);
    return text.slice(0, text.length - hold);
  }

  flush(): string {
    const rest = this.captured ? "" : this.pending;
    this.pending = "";
    return rest;
  }
}

function parseFinding(tag: string): Finding | null {
  const t = tag.toLowerCase();
  if (/not[_\s-]?found/.test(t)) return "not_found";
  if (t.includes("partial")) return "partial";
  if (t.includes("found")) return "found";
  return null;
}

function fullyRead(doc: ChatDoc, state: AgentState): boolean {
  let n = 0;
  for (const c of state.read.values()) if (c.doc.id === doc.id) n++;
  return n >= doc.chunkCount;
}

function pickDocs(label: unknown, docs: ChatDoc[]): ChatDoc[] | null {
  if (typeof label !== "string" || !label.trim()) return docs;
  const doc = docs.find((d) => d.label.toLowerCase() === label.trim().toLowerCase());
  return doc ? [doc] : null;
}

function applyScan(scan: ScanResult, scope: ChatDoc[], state: AgentState) {
  for (const d of scope) state.scanned.add(d.id);
  for (const c of scan.read) state.read.set(c.label, c);
  for (const c of scan.relevant) state.retrieved.set(c.label, c);
  for (const [docId, pages] of scan.failedPages) {
    state.failedPages.set(docId, [...(state.failedPages.get(docId) ?? []), ...pages]);
  }
}

function scanResponse(scan: ScanResult, scope: ChatDoc[]): Record<string, unknown> {
  const failed = scope
    .filter((d) => scan.failedPages.has(d.id))
    .map((d) => `${d.label}: ${formatPages(scan.failedPages.get(d.id)!)} could not be read`);
  return {
    coverage: failed.length
      ? `Most of the document was read, but: ${failed.join("; ")}. Do not claim anything is absent from those pages.`
      : "Every passage of the document was read.",
    relevant_passages: formatChunks(scan.relevant, scope.length > 1),
    notes_by_part: scan.notes,
  };
}
