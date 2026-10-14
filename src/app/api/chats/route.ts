import { connection } from "next/server";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chatDocuments, chats, documents } from "@/lib/db/schema";
import { NEW_CHAT_TITLE } from "@/lib/chat/respond";
import { MAX_CHAT_DOCUMENTS } from "@/lib/documents/constants";

/**
 * Without parameters: recent chats that have at least one question, with their documents.
 * With ?document=<id>: chats that include that document, newest first.
 */
export async function GET(request: Request) {
  await connection();
  const documentId = new URL(request.url).searchParams.get("document");
  if (documentId === null) return Response.json(await recentChats());
  if (!z.string().uuid().safeParse(documentId).success) {
    return Response.json({ error: "Invalid document id." }, { status: 400 });
  }
  const rows = await db
    .select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt })
    .from(chats)
    .innerJoin(chatDocuments, eq(chatDocuments.chatId, chats.id))
    .where(eq(chatDocuments.documentId, documentId))
    .orderBy(desc(chats.updatedAt));
  return Response.json(rows);
}

const RECENT_LIMIT = 8;

async function recentChats() {
  const rows = await db
    .select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt })
    .from(chats)
    .where(ne(chats.title, NEW_CHAT_TITLE))
    .orderBy(desc(chats.updatedAt))
    .limit(RECENT_LIMIT);
  if (!rows.length) return [];
  const docs = await db
    .select({ chatId: chatDocuments.chatId, name: documents.name, position: chatDocuments.position })
    .from(chatDocuments)
    .innerJoin(documents, eq(documents.id, chatDocuments.documentId))
    .where(inArray(chatDocuments.chatId, rows.map((r) => r.id)))
    .orderBy(asc(chatDocuments.position));
  return rows
    .map((r) => ({ ...r, documents: docs.filter((d) => d.chatId === r.id).map((d) => d.name) }))
    .filter((r) => r.documents.length > 0);
}

const createSchema = z.object({ documentIds: z.array(z.string().uuid()).min(1).max(MAX_CHAT_DOCUMENTS) });

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: `Choose between 1 and ${MAX_CHAT_DOCUMENTS} documents.` }, { status: 400 });
  }
  const ids = [...new Set(parsed.data.documentIds)];

  const ready = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(inArray(documents.id, ids), eq(documents.status, "ready")));
  if (ready.length !== ids.length) {
    return Response.json({ error: "Some documents are missing or still processing." }, { status: 400 });
  }

  const [chat] = await db.insert(chats).values({ title: NEW_CHAT_TITLE }).returning({ id: chats.id });
  await db.insert(chatDocuments).values(ids.map((documentId, position) => ({ chatId: chat.id, documentId, position })));
  return Response.json(chat, { status: 201 });
}
