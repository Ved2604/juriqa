import { connection } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chatDocuments, chats, documents } from "@/lib/db/schema";
import { NEW_CHAT_TITLE } from "@/lib/chat/respond";

/** Chats that include the given document, newest first. */
export async function GET(request: Request) {
  await connection();
  const documentId = new URL(request.url).searchParams.get("document");
  if (!documentId || !z.string().uuid().safeParse(documentId).success) {
    return Response.json({ error: "A document id is required." }, { status: 400 });
  }
  const rows = await db
    .select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt })
    .from(chats)
    .innerJoin(chatDocuments, eq(chatDocuments.chatId, chats.id))
    .where(eq(chatDocuments.documentId, documentId))
    .orderBy(desc(chats.updatedAt));
  return Response.json(rows);
}

const createSchema = z.object({ documentIds: z.array(z.string().uuid()).min(1).max(10) });

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose at least one document." }, { status: 400 });
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
