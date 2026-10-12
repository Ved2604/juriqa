import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatDocuments, documents } from "@/lib/db/schema";

/** A document as the AI sees it: labelled D1, D2, ... in chat order. */
export type ChatDoc = {
  label: string;
  id: string;
  name: string;
  pageCount: number | null;
  chunkCount: number;
  unreadablePages: number[];
};

export async function loadChatDocs(chatId: string): Promise<ChatDoc[]> {
  const rows = await db
    .select({
      id: documents.id,
      name: documents.name,
      pageCount: documents.pageCount,
      chunkCount: documents.chunkCount,
      unreadablePages: documents.unreadablePages,
      status: documents.status,
    })
    .from(chatDocuments)
    .innerJoin(documents, eq(documents.id, chatDocuments.documentId))
    .where(eq(chatDocuments.chatId, chatId))
    .orderBy(asc(chatDocuments.position));

  return rows
    .filter((r) => r.status === "ready")
    .map((r, i) => ({
      label: `D${i + 1}`,
      id: r.id,
      name: r.name,
      pageCount: r.pageCount,
      chunkCount: r.chunkCount ?? 0,
      unreadablePages: r.unreadablePages,
    }));
}

export function chunkLabel(doc: ChatDoc, index: number): string {
  return `${doc.label}-C${index}`;
}

/** "D2-C87" -> { doc, index }, or null if the label is malformed or unknown. */
export function parseLabel(label: string, docs: ChatDoc[]): { doc: ChatDoc; index: number } | null {
  const m = /^(D\d+)-C(\d+)$/.exec(label.trim());
  if (!m) return null;
  const doc = docs.find((d) => d.label === m[1]);
  const index = Number(m[2]);
  if (!doc || index >= doc.chunkCount) return null;
  return { doc, index };
}
