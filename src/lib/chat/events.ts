import type { Citation, Coverage, MessageStatus, RouteType, TraceStep } from "@/lib/db/schema";

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
  | { type: "coverage"; coverage: Coverage }
  | { type: "done"; status: MessageStatus; error?: string };

/** One cited item: an ID (D1-C87) or a range (D1-C87–D1-C90, D1-C87-90). */
const ITEM = String.raw`D\d+-C\d+(?:\s*[–—-]\s*(?:D\d+-)?C?\d+)?`;

/** Matches citation groups such as [D1-C87], [D1-C87, D2-C4] or [D1-C87–D1-C90]. */
export const CITATION_GROUP = new RegExp(String.raw`\[\s*(${ITEM}(?:\s*[,;]\s*${ITEM})*)\s*\]`, "g");

/** Longest range expanded into individual citations; longer ones keep only the endpoints. */
const MAX_RANGE = 25;

/** "D1-C87, D1-C90–D1-C92" -> ["D1-C87", "D1-C90", "D1-C91", "D1-C92"]. */
export function expandGroup(group: string): string[] {
  const ids: string[] = [];
  for (const item of group.split(/\s*[,;]\s*/)) {
    const m = /^D(\d+)-C(\d+)(?:\s*[–—-]\s*(?:D(\d+)-)?C?(\d+))?$/.exec(item.trim());
    if (!m) continue;
    const [, doc, from, toDoc, to] = m;
    const a = Number(from);
    const b = to !== undefined ? Number(to) : a;
    if (to === undefined || (toDoc && toDoc !== doc) || b < a) {
      ids.push(`D${doc}-C${a}`);
      if (to !== undefined) ids.push(`D${toDoc ?? doc}-C${b}`);
    } else if (b - a > MAX_RANGE) {
      ids.push(`D${doc}-C${a}`, `D${doc}-C${b}`);
    } else {
      for (let i = a; i <= b; i++) ids.push(`D${doc}-C${i}`);
    }
  }
  return ids;
}

export function citedIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(CITATION_GROUP)) {
    for (const id of expandGroup(m[1])) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
