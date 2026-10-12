import type { Citation, DocumentKind, MessageRow } from "@/lib/db/schema";

/** A message as the chat UI holds it: the saved row plus live-only fields while streaming. */
export type UiMessage = Omit<MessageRow, "chatId" | "createdAt" | "readChunks"> & {
  /** Latest progress text while the answer is being produced. */
  liveStatus?: string;
};

export type ChatDocInfo = {
  id: string;
  label: string;
  name: string;
  kind: DocumentKind;
  status: string;
  pageCount: number | null;
  unreadablePages: number[];
  blobUrl: string;
};

export type ChatData = {
  chat: { id: string; title: string };
  documents: ChatDocInfo[];
  messages: UiMessage[];
};

export type ChatSummary = { id: string; title: string; updatedAt: string };

export type SelectedCitation = { citation: Citation; number: number };
