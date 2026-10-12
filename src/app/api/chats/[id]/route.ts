import { connection } from "next/server";
import { and, asc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chatDocuments, chats, documents, messages } from "@/lib/db/schema";

const notFound = () => Response.json({ error: "Chat not found." }, { status: 404 });
const STALE_STREAM_MS = 6 * 60 * 1000;

export async function GET(_req: Request, ctx: RouteContext<"/api/chats/[id]">) {
  await connection();
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return notFound();

  const [chat] = await db.select().from(chats).where(eq(chats.id, id));
  if (!chat) return notFound();

  // An answer still "streaming" long after it started was cut off (e.g. server restart).
  await db
    .update(messages)
    .set({ status: "error", error: "This answer was interrupted." })
    .where(
      and(
        eq(messages.chatId, id),
        eq(messages.status, "streaming"),
        lt(messages.createdAt, new Date(Date.now() - STALE_STREAM_MS)),
      ),
    );

  const [docs, msgs] = await Promise.all([
    db
      .select({
        id: documents.id,
        name: documents.name,
        kind: documents.kind,
        status: documents.status,
        pageCount: documents.pageCount,
        unreadablePages: documents.unreadablePages,
        blobUrl: documents.blobUrl,
      })
      .from(chatDocuments)
      .innerJoin(documents, eq(documents.id, chatDocuments.documentId))
      .where(eq(chatDocuments.chatId, id))
      .orderBy(asc(chatDocuments.position)),
    db.select().from(messages).where(eq(messages.chatId, id)).orderBy(asc(messages.createdAt)),
  ]);

  return Response.json({
    chat,
    documents: docs.map((d, i) => ({ ...d, label: `D${i + 1}` })),
    messages: msgs,
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/chats/[id]">) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return notFound();
  const deleted = await db.delete(chats).where(eq(chats.id, id)).returning({ id: chats.id });
  return deleted.length ? new Response(null, { status: 204 }) : notFound();
}
