import { connection } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chunks } from "@/lib/db/schema";

export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]/chunks">) {
  await connection();
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Document not found." }, { status: 404 });
  }
  const rows = await db
    .select({
      index: chunks.index,
      text: chunks.text,
      heading: chunks.heading,
      clause: chunks.clause,
      pageStart: chunks.pageStart,
      pageEnd: chunks.pageEnd,
      wordCount: chunks.wordCount,
      boxes: chunks.boxes,
    })
    .from(chunks)
    .where(eq(chunks.documentId, id))
    .orderBy(asc(chunks.index));
  return Response.json(rows);
}
