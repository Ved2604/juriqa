import { connection } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { comparisons, documents } from "@/lib/db/schema";
import { expireStaleComparisons } from "@/lib/compare/run";

export async function GET(_req: Request, ctx: RouteContext<"/api/comparisons/[id]">) {
  await connection();
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Comparison not found." }, { status: 404 });
  }
  await expireStaleComparisons();
  const [row] = await db.select().from(comparisons).where(eq(comparisons.id, id));
  if (!row) return Response.json({ error: "Comparison not found." }, { status: 404 });

  const docs = await db
    .select({ id: documents.id, name: documents.name, kind: documents.kind, pageCount: documents.pageCount })
    .from(documents)
    .where(inArray(documents.id, [row.oldDocumentId, row.newDocumentId]));

  return Response.json({
    ...row,
    oldDocument: docs.find((d) => d.id === row.oldDocumentId) ?? null,
    newDocument: docs.find((d) => d.id === row.newDocumentId) ?? null,
  });
}
