import { connection } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chunks } from "@/lib/db/schema";

/** All chunks of a document, or only `?indexes=3,87` (used to highlight citations). */
export async function GET(request: Request, ctx: RouteContext<"/api/documents/[id]/chunks">) {
  await connection();
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Document not found." }, { status: 404 });
  }
  const param = new URL(request.url).searchParams.get("indexes");
  const indexes = param
    ?.split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0)
    .slice(0, 50);

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
    .where(and(eq(chunks.documentId, id), indexes ? inArray(chunks.index, indexes) : undefined))
    .orderBy(asc(chunks.index));
  return Response.json(rows);
}
