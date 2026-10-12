import type { Citation, MessageStatus, RouteType, TraceStep } from "@/lib/db/schema";

/** Events streamed (as newline-delimited JSON) from POST /api/chats/:id/messages. */
export type ChatEvent =
  | { type: "start"; userMessageId: string; assistantMessageId: string }
  | { type: "route"; route: RouteType }
  | { type: "status"; text: string }
  | { type: "trace"; step: TraceStep }
  | { type: "text"; delta: string }
  /** Text streamed in a round that turned out to be a tool-calling round; discard it. */
  | { type: "reset_text" }
  | { type: "citations"; citations: Citation[]; invalid: string[] }
  | { type: "done"; status: MessageStatus; error?: string };

/** Matches citation groups such as [D1-C87] or [D1-C87, D2-C4]. */
export const CITATION_GROUP = /\[\s*(D\d+-C\d+(?:\s*[,;]\s*D\d+-C\d+)*)\s*\]/g;

export function citedIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(CITATION_GROUP)) {
    for (const id of m[1].split(/\s*[,;]\s*/)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
