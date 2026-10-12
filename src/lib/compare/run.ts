import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { type ClauseChange, type Significance, chunks, comparisons, documents } from "@/lib/db/schema";
import { alignUnits, pairKind } from "./align";
import { type ChangeInput, assessChanges, writeOverview } from "./assess";
import { figureChanges } from "./figures";
import { buildUnits } from "./units";

const STALE_AFTER_MS = 6 * 60 * 1000;

async function update(id: string, values: Partial<typeof comparisons.$inferInsert>) {
  await db
    .update(comparisons)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(comparisons.id, id));
}

async function loadUnits(documentId: string) {
  const rows = await db
    .select({
      index: chunks.index,
      text: chunks.text,
      heading: chunks.heading,
      clause: chunks.clause,
      pageStart: chunks.pageStart,
      pageEnd: chunks.pageEnd,
    })
    .from(chunks)
    .where(eq(chunks.documentId, documentId))
    .orderBy(asc(chunks.index));
  return buildUnits(rows);
}

const RANK: Record<Significance, number> = { cosmetic: 0, low: 1, medium: 2, high: 3 };

export async function runComparison(id: string): Promise<void> {
  try {
    const [row] = await db.select().from(comparisons).where(eq(comparisons.id, id));
    if (!row) return;
    const docs = await db
      .select({ id: documents.id, name: documents.name })
      .from(documents)
      .where(inArray(documents.id, [row.oldDocumentId, row.newDocumentId]));
    const nameOf = (docId: string) => docs.find((d) => d.id === docId)?.name ?? "Document";

    await update(id, { step: "Matching clauses" });
    const [oldUnits, newUnits] = await Promise.all([loadUnits(row.oldDocumentId), loadUnits(row.newDocumentId)]);
    const pairs = alignUnits(oldUnits, newUnits);

    const changes: ClauseChange[] = [];
    const toAssess: ChangeInput[] = [];
    let unchanged = 0;

    for (const p of pairs) {
      const kind = pairKind(p);
      if (kind === "unchanged") {
        unchanged++;
        continue;
      }
      const change: ClauseChange = {
        id: changes.length,
        type: kind === "added" ? "added" : kind === "removed" ? "removed" : "modified",
        significance: "cosmetic",
        summary: "",
        heading: p.new?.heading ?? p.old?.heading ?? null,
        oldClause: p.old?.key ?? null,
        newClause: p.new?.key ?? null,
        oldText: p.old?.text ?? null,
        newText: p.new?.text ?? null,
        oldPages: p.old?.pages ?? null,
        newPages: p.new?.pages ?? null,
        numberChanges: figureChanges(p.old?.text ?? null, p.new?.text ?? null),
        order: changes.length,
        assessed: true,
      };
      if (kind === "renumbered") {
        change.summary = `Renumbered from clause ${change.oldClause ?? "?"} to ${change.newClause ?? "?"}; the text is unchanged.`;
      } else if (kind === "formatting") {
        change.summary = "Only punctuation, capitalisation or spacing changed; the wording is the same.";
      } else {
        toAssess.push({
          id: change.id,
          type: change.type,
          heading: change.heading,
          clause: change.newClause ?? change.oldClause,
          oldText: change.oldText,
          newText: change.newText,
          figures: change.numberChanges,
        });
      }
      changes.push(change);
    }

    await update(id, { step: toAssess.length ? `Assessing ${toAssess.length} changed clauses` : "Writing summary" });
    const assessments = await assessChanges(toAssess, (done, total) =>
      update(id, { step: `Assessing changed clauses (${done} of ${total})` }),
    );

    let unassessed = 0;
    for (const input of toAssess) {
      const change = changes[input.id];
      const a = assessments.get(input.id);
      if (a) {
        change.summary = a.summary;
        change.significance = a.significance;
      } else {
        unassessed++;
        change.assessed = false;
        change.significance = "medium";
        change.summary = "This change could not be assessed automatically. Review the old and new text below.";
      }
      // Code-detected figure changes are never rated below high, whatever the AI said.
      if (change.numberChanges && RANK[change.significance] < RANK.high) change.significance = "high";
    }

    await update(id, { step: "Writing summary" });
    const substantive = changes
      .filter((c) => c.significance !== "cosmetic")
      .sort((a, b) => RANK[b.significance] - RANK[a.significance]);
    const overview = await writeOverview(
      nameOf(row.oldDocumentId),
      nameOf(row.newDocumentId),
      (substantive.length ? substantive : changes).slice(0, 60).map((c) => ({
        significance: c.significance,
        where: c.newClause ?? c.oldClause ? `Clause ${c.newClause ?? c.oldClause}` : (c.heading ?? "Unnumbered text"),
        summary: c.summary,
      })),
    ).catch((e) => {
      console.error("Overview failed", e);
      return "";
    });

    await update(id, {
      status: "ready",
      step: null,
      result: { overview, changes, unchanged, unassessed },
    });
  } catch (e) {
    console.error(`Comparison ${id} failed`, e);
    await update(id, {
      status: "failed",
      step: null,
      error: "The comparison could not be completed. Please try again.",
    }).catch(() => {});
  }
}

export async function expireStaleComparisons(): Promise<void> {
  await db
    .update(comparisons)
    .set({ status: "failed", step: null, error: "The comparison was interrupted. Please run it again." })
    .where(and(eq(comparisons.status, "processing"), lt(comparisons.updatedAt, new Date(Date.now() - STALE_AFTER_MS))));
}
