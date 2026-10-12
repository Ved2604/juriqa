import { after, connection } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { comparisons, documents } from "@/lib/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { runComparison } from "@/lib/compare/run";

// The comparison runs in after(), which shares this route's time budget.
export const maxDuration = 300;

/** Recent comparisons with document names and change counts, for the library. */
export async function GET() {
  await connection();
  const oldDoc = alias(documents, "old_doc");
  const newDoc = alias(documents, "new_doc");
  const rows = await db
    .select({
      id: comparisons.id,
      status: comparisons.status,
      createdAt: comparisons.createdAt,
      result: comparisons.result,
      oldId: comparisons.oldDocumentId,
      newId: comparisons.newDocumentId,
      oldName: oldDoc.name,
      newName: newDoc.name,
    })
    .from(comparisons)
    .innerJoin(oldDoc, eq(oldDoc.id, comparisons.oldDocumentId))
    .innerJoin(newDoc, eq(newDoc.id, comparisons.newDocumentId))
    .orderBy(desc(comparisons.createdAt))
    .limit(20);

  // Show only the latest run of each pair.
  const seen = new Set<string>();
  const latest = rows.filter((r) => {
    const key = `${r.oldId}|${r.newId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return Response.json(
    latest.slice(0, 8).map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      oldName: r.oldName,
      newName: r.newName,
      changes: r.result?.changes.length ?? null,
      high: r.result?.changes.filter((c) => c.significance === "high").length ?? null,
    })),
  );
}

const bodySchema = z.object({
  oldDocumentId: z.string().uuid(),
  newDocumentId: z.string().uuid(),
  /** Run again even if a finished comparison of this pair exists. */
  rerun: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose two documents to compare." }, { status: 400 });
  const { oldDocumentId, newDocumentId, rerun } = parsed.data;
  if (oldDocumentId === newDocumentId) {
    return Response.json({ error: "Choose two different documents." }, { status: 400 });
  }

  const ready = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(inArray(documents.id, [oldDocumentId, newDocumentId]), eq(documents.status, "ready")));
  if (ready.length !== 2) {
    return Response.json({ error: "Both documents must be uploaded and ready." }, { status: 400 });
  }

  if (!rerun) {
    const [existing] = await db
      .select({ id: comparisons.id })
      .from(comparisons)
      .where(
        and(
          eq(comparisons.oldDocumentId, oldDocumentId),
          eq(comparisons.newDocumentId, newDocumentId),
          inArray(comparisons.status, ["ready", "processing"]),
        ),
      )
      .orderBy(desc(comparisons.createdAt))
      .limit(1);
    if (existing) return Response.json(existing);
  }

  const [row] = await db
    .insert(comparisons)
    .values({ oldDocumentId, newDocumentId, step: "Queued" })
    .returning({ id: comparisons.id });
  after(() => runComparison(row.id));
  return Response.json(row, { status: 201 });
}
