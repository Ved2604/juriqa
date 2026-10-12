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
    .select()
    .from(chunks)
    .where(eq(chunks.documentId, id))
    .orderBy(asc(chunks.index));
  return Response.json(rows);
}
