import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { AiUnavailableError } from "@/lib/ai/retry";
import { type Citation, type Coverage, type MessageStatus, type RouteType, chats, messages } from "@/lib/db/schema";
import { type AgentState, type HistoryMessage, newAgentState, runAgent } from "./agent";
import { type ChatDoc, loadChatDocs } from "./context";
import { type ChatEvent, citedIds } from "./events";
import { refusalText, routeQuestion } from "./router";
import type { RetrievedChunk } from "./tools";

const HISTORY_LIMIT = 10;
export const NEW_CHAT_TITLE = "New chat";

function toCitation(c: RetrievedChunk): Citation {
  return {
    id: c.label,
    documentId: c.doc.id,
    documentName: c.doc.name,
    index: c.index,
    text: c.text,
    heading: c.heading,
    clause: c.clause,
    pageStart: c.pageStart,
    pageEnd: c.pageEnd,
  };
}

/**
 * Check every cited ID against what the model actually retrieved (in this answer,
 * or verified in an earlier answer of this chat). Anything else is invalid:
 * the model made it up or never read it.
 */
export function validateCitations(
  text: string,
  retrieved: Map<string, RetrievedChunk>,
  prior: Map<string, Citation>,
): { citations: Citation[]; invalid: string[] } {
  const citations: Citation[] = [];
  const invalid: string[] = [];
  for (const id of citedIds(text)) {
    const chunk = retrieved.get(id);
    if (chunk) citations.push(toCitation(chunk));
    else if (prior.has(id)) citations.push(prior.get(id)!);
    else invalid.push(id);
  }
  return { citations, invalid };
}

/** Answer a question in a chat, streaming events. Persists the answer even if the client stops it. */
export function respond(chatId: string, question: string): ReadableStream<Uint8Array> {
  const abort = new AbortController();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };

      let state: AgentState = newAgentState();
      let route: RouteType | null = null;
      let status: MessageStatus = "complete";
      let error: string | undefined;
      let assistantId: string | undefined;
      let prior = new Map<string, Citation>();
      let docs: ChatDoc[] = [];

      try {
        docs = await loadChatDocs(chatId);
        if (!docs.length) throw new UserFacingError("None of this chat's documents are ready to answer questions.");

        const previous = await db
          .select()
          .from(messages)
          .where(eq(messages.chatId, chatId))
          .orderBy(asc(messages.createdAt));
        prior = new Map(previous.flatMap((m) => m.citations.map((c) => [c.id, c] as const)));
        const history = answeredPairs(previous).slice(-HISTORY_LIMIT);

        const [user] = await db.insert(messages).values({ chatId, role: "user", content: question }).returning({ id: messages.id });
        const [assistant] = await db
          .insert(messages)
          .values({ chatId, role: "assistant", content: "", status: "streaming" })
          .returning({ id: messages.id });
        assistantId = assistant.id;
        await touchChat(chatId, question, previous.length === 0);
        send({ type: "start", userMessageId: user.id, assistantMessageId: assistant.id });

        send({ type: "status", text: "Understanding the question" });

        // Most questions are about the document, so research starts while the router decides.
        // Its events are held back until the router agrees; otherwise the work is discarded.
        const speculative = new AbortController();
        abort.signal.addEventListener("abort", () => speculative.abort());
        const research = buffered(runAgent({ question, history, docs, signal: speculative.signal, state }));

        const decision = await routeQuestion(question, history, docs, abort.signal);
        route = decision.type;
        send({ type: "route", route });

        if (decision.type !== "document" || decision.needs_full_document) {
          speculative.abort();
          await research.finished;
          state = newAgentState();
        }

        if (decision.type !== "document") {
          state.text = refusalText(decision, docs);
          send({ type: "text", delta: state.text });
        } else if (decision.needs_full_document) {
          for await (const event of runAgent({ question, history, docs, signal: abort.signal, state, fullDocument: true })) {
            send(event);
          }
        } else {
          for await (const event of research.drain()) send(event);
        }
      } catch (e) {
        if (abort.signal.aborted) {
          status = "stopped";
        } else {
          status = "error";
          error =
            e instanceof UserFacingError || e instanceof AiUnavailableError
              ? e.message
              : "Something went wrong while answering. Please try again.";
          console.error("Answer failed", e);
        }
      }

      const { citations, invalid } = validateCitations(state.text, state.retrieved, prior);
      send({ type: "citations", citations, invalid });
      const coverage = route === "document" ? computeCoverage(docs, state) : null;
      if (coverage) send({ type: "coverage", coverage });

      if (assistantId) {
        await db
          .update(messages)
          .set({
            content: state.text,
            status,
            route,
            citations,
            invalidCitations: invalid,
            trace: state.trace,
            readChunks: [...state.read.keys()],
            coverage,
            error: error ?? null,
          })
          .where(eq(messages.id, assistantId))
          .catch((e) => console.error("Failed to save answer", e));
      }

      send({ type: "done", status, error });
      if (open) controller.close();
    },
    cancel() {
      // The browser stopped reading (Stop button or closed tab): stop generating, keep what we have.
      abort.abort();
    },
  });
}

class UserFacingError extends Error {}

/**
 * Run an async generator in the background, collecting its values, so they can
 * be replayed later with drain(). Errors are rethrown from drain().
 */
function buffered<T>(gen: AsyncGenerator<T>) {
  const items: T[] = [];
  let done = false;
  let failure: { error: unknown } | null = null;
  // Held in an object so TypeScript sees assignments made inside closures.
  const waiter: { wake: (() => void) | null } = { wake: null };

  const finished = (async () => {
    try {
      for await (const item of gen) {
        items.push(item);
        waiter.wake?.();
      }
    } catch (error) {
      failure = { error };
    } finally {
      done = true;
      waiter.wake?.();
    }
  })();

  async function* drain(): AsyncGenerator<T> {
    for (;;) {
      if (items.length) {
        yield items.shift()!;
        continue;
      }
      if (done) {
        if (failure) throw failure.error;
        return;
      }
      await new Promise<void>((resolve) => (waiter.wake = resolve));
      waiter.wake = null;
    }
  }

  return { finished, drain };
}

/** What was actually read, per document. Computed from our own records, never from the AI's claims. */
export function computeCoverage(docs: ChatDoc[], state: AgentState): Coverage {
  return {
    finding: state.finding,
    documents: docs.map((d) => {
      const read = [...state.read.values()].filter((c) => c.doc.id === d.id);
      const pages = new Set<number>();
      for (const c of read) {
        if (c.pageStart && c.pageEnd) for (let p = c.pageStart; p <= c.pageEnd; p++) pages.add(p);
      }
      const failedPages = [...new Set(state.failedPages.get(d.id) ?? [])].sort((a, b) => a - b);
      return {
        documentId: d.id,
        label: d.label,
        name: d.name,
        totalChunks: d.chunkCount,
        readChunks: read.length,
        finding: state.findings.get(d.label) ?? null,
        full: read.length >= d.chunkCount,
        fullScan: state.scanned.has(d.id),
        pagesRead: [...pages].sort((a, b) => a - b),
        failedPages,
        scannedPages: d.unreadablePages,
      };
    }),
  };
}

/**
 * Earlier turns to give the model, as question/answer pairs. A question whose
 * answer failed or was stopped before any text is dropped; otherwise the model
 * sees two questions in a row and may answer the old one.
 */
function answeredPairs(previous: { role: string; content: string }[]): HistoryMessage[] {
  const out: HistoryMessage[] = [];
  for (let i = 0; i < previous.length - 1; i++) {
    const [q, a] = [previous[i], previous[i + 1]];
    if (q.role === "user" && a.role === "assistant" && a.content.trim()) {
      out.push({ role: "user", content: q.content }, { role: "assistant", content: a.content });
      i++;
    }
  }
  return out;
}

async function touchChat(chatId: string, question: string, first: boolean) {
  const title = question.replace(/\s+/g, " ").trim();
  await db
    .update(chats)
    .set({
      updatedAt: new Date(),
      ...(first ? { title: title.length > 70 ? `${title.slice(0, 67)}…` : title } : {}),
    })
    .where(eq(chats.id, chatId));
}
