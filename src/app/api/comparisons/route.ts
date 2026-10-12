import { after } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { comparisons, documents } from "@/lib/db/schema";
import { runComparison } from "@/lib/compare/run";

// The comparison runs in after(), which shares this route's time budget.
export const maxDuration = 300;

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
