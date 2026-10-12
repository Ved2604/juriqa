import { type Content, FunctionCallingConfigMode, type Part, ThinkingLevel } from "@google/genai";
import { gemini } from "@/lib/ai/gemini";
import { withRetry } from "@/lib/ai/retry";
import type { TraceStep } from "@/lib/db/schema";
import type { ChatDoc } from "./context";
import type { ChatEvent } from "./events";
import { FINAL_ROUND_NOTE, MALFORMED_CALL_NOTE, MAX_ROUNDS, agentSystemPrompt } from "./prompts";
import { type RetrievedChunk, runTool, toolDeclarations } from "./tools";

/** Mutable state the caller reads to persist the answer, including after a stop. */
export type AgentState = {
  text: string;
  trace: TraceStep[];
  /** Every chunk whose text the model has seen while answering, by label. */
  retrieved: Map<string, RetrievedChunk>;
};

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
}): AsyncGenerator<ChatEvent> {
  const { question, history, docs, signal, state } = opts;

  const contents: Content[] = history
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }));
  contents.push({ role: "user", parts: [{ text: question }] });

  yield { type: "status", text: "Planning research" };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const finalRound = round === MAX_ROUNDS - 1;
    if (finalRound) contents[contents.length - 1].parts!.push({ text: FINAL_ROUND_NOTE });

    const stream = await withRetry(
      (model) =>
        gemini().models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction: agentSystemPrompt(docs),
            tools: [{ functionDeclarations: toolDeclarations }],
            toolConfig: finalRound
              ? { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } }
              : undefined,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            abortSignal: signal,
          },
        }),
      signal,
    );

    const parts: Part[] = [];
    let roundText = "";
    let finishReason: string | undefined;
    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      finishReason = candidate?.finishReason ?? finishReason;
      for (const part of candidate?.content?.parts ?? []) {
        parts.push(part);
        if (part.text && !part.thought) {
          roundText += part.text;
          state.text = roundText;
          yield { type: "text", delta: part.text };
        }
      }
    }

    const calls = parts.filter((p) => p.functionCall);
    if (calls.length && !finalRound) {
      if (roundText) {
        // Text before a tool call is the model thinking aloud, not the answer.
        state.text = "";
        yield { type: "reset_text" };
      }
      // Send the model's parts back unchanged: they carry thought signatures Gemini requires.
      contents.push({ role: "model", parts });

      const responses: Part[] = [];
      for (const { functionCall } of calls) {
        const name = functionCall!.name ?? "";
        const args = functionCall!.args as Record<string, unknown> | undefined;
        yield { type: "status", text: statusLabel(name, args) };
        const result = await runTool(name, args, docs);
        for (const c of result.chunks) state.retrieved.set(c.label, c);
        const step: TraceStep = { tool: name, label: result.label, ok: result.ok, resultCount: result.chunks.length };
        state.trace.push(step);
        yield { type: "trace", step };
        responses.push({ functionResponse: { id: functionCall!.id, name, response: result.response } });
      }
      contents.push({ role: "user", parts: responses });
      yield { type: "status", text: "Reviewing what I found" };
      continue;
    }

    if (roundText.trim()) return;

    // No answer and no usable tool call: typically a malformed function call.
    const step: TraceStep = { tool: "invalid", label: "Malformed tool call (ignored)", ok: false };
    state.trace.push(step);
    yield { type: "trace", step };
    if (finalRound) break;
    console.warn(`Agent round ${round} produced no output (finishReason: ${finishReason})`);
    if (parts.length) contents.push({ role: "model", parts });
    contents.push({ role: "user", parts: [{ text: MALFORMED_CALL_NOTE }] });
  }

  throw new Error("The model did not produce an answer.");
}
