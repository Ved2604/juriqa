import { connection } from "next/server";
import { del } from "@vercel/blob";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chatDocuments, chats, documents } from "@/lib/db/schema";
import { listColumns } from "@/lib/documents/queries";
import { expireStaleDocuments } from "@/lib/processing/process";

const isUuid = (id: string) => z.string().uuid().safeParse(id).success;
const notFound = () => Response.json({ error: "Document not found." }, { status: 404 });

export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  await connection();
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  await expireStaleDocuments();
  const [doc] = await db.select(listColumns).from(documents).where(eq(documents.id, id));
  return doc ? Response.json(doc) : notFound();
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();

  // Chats that use this document are deleted with it. Keeping them would renumber the
  // remaining documents (D2 becomes D1) and leave old citations pointing at the wrong one.
  const linked = await db
    .select({ chatId: chatDocuments.chatId })
    .from(chatDocuments)
    .where(eq(chatDocuments.documentId, id));
  if (linked.length) {
    await db.delete(chats).where(inArray(chats.id, linked.map((l) => l.chatId)));
  }

  const [doc] = await db
    .delete(documents)
    .where(eq(documents.id, id))
    .returning({ blobUrl: documents.blobUrl });
  if (!doc) return notFound();
  // Chunks and comparisons are removed by the foreign-key cascade. A failed file delete only leaves an orphaned file.
  await del(doc.blobUrl).catch((e) => console.error("Blob delete failed", e));
  return new Response(null, { status: 204 });
}
