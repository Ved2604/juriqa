import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { chunks, documents } from "@/lib/db/schema";
import { chunkBlocks } from "./chunk";
import { extractDocx } from "./docx";
import { extractPdf } from "./pdf";
import { sniffKind } from "./sniff";
import { ProcessingError } from "./types";
import { formatPages } from "@/lib/pages";

/** A document still "processing" after this long was interrupted (e.g. the server restarted). */
const STALE_AFTER_MS = 6 * 60 * 1000;

async function update(id: string, values: Partial<typeof documents.$inferInsert>) {
  await db
    .update(documents)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(documents.id, id));
}

export async function processDocument(id: string): Promise<void> {
  try {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    if (!doc) return;

    await update(id, { step: "Checking file" });
    const res = await fetch(doc.blobUrl);
    if (!res.ok) throw new Error(`Blob download failed: ${res.status}`);
    const data = new Uint8Array(await res.arrayBuffer());

    const actual = sniffKind(data);
    if (!actual) {
      throw new ProcessingError("This file is not a valid PDF or Word document.");
    }
    if (actual !== doc.kind) {
      throw new ProcessingError(
        `This file is named .${doc.kind} but is actually a ${actual.toUpperCase()} file. Rename it and upload again.`,
      );
    }

    let html: string | null = null;
    let pageCount: number | null = null;
    let scannedPages: number[] = [];
    let drafts;

    if (doc.kind === "pdf") {
      const out = await extractPdf(data, (step) => update(id, { step }));
      pageCount = out.pageCount;
      scannedPages = out.scannedPages;
      await update(id, { step: "Splitting into clauses" });
      drafts = chunkBlocks(out.blocks);
    } else {
      await update(id, { step: "Extracting text" });
      const out = await extractDocx(data);
      await update(id, { step: "Splitting into clauses" });
      drafts = chunkBlocks(out.blocks);
      // Tag each HTML element with the chunk(s) it belongs to, for highlighting.
      const tags = new Map<number, number[]>();
      drafts.forEach((c, i) => {
        for (const el of c.elementIndexes) tags.set(el, [...(tags.get(el) ?? []), i]);
      });
      for (const [el, ids] of tags) out.elements[el].setAttribute("data-chunk", ids.join(" "));
      html = out.root.toString();
    }

    await update(id, { step: "Saving" });
    await db.delete(chunks).where(eq(chunks.documentId, id));
    const rows = drafts.map((c, index) => ({
      documentId: id,
      index,
      text: c.text,
      heading: c.heading,
      clause: c.clause,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      wordCount: c.wordCount,
      boxes: c.boxes,
    }));
    for (let i = 0; i < rows.length; i += 100) {
      await db.insert(chunks).values(rows.slice(i, i + 100));
    }

    await update(id, {
      status: "ready",
      step: null,
      pageCount,
      unreadablePages: scannedPages,
      chunkCount: rows.length,
      html,
      warning: scannedPages.length
        ? `${formatPages(scannedPages)} ${scannedPages.length === 1 ? "is a scanned image" : "are scanned images"} with no readable text. Answers will not cover ${scannedPages.length === 1 ? "it" : "them"}.`
        : null,
    });
  } catch (e) {
    console.error(`Processing failed for document ${id}`, e);
    await update(id, {
      status: "failed",
      step: null,
      error:
        e instanceof ProcessingError
          ? e.userMessage
          : "Something went wrong while processing this file. Delete it and try uploading again.",
    }).catch(() => {});
  }
}

/** Mark documents stuck in "processing" as failed so the UI never spins forever. */
export async function expireStaleDocuments(): Promise<void> {
  await db
    .update(documents)
    .set({
      status: "failed",
      step: null,
      error: "Processing was interrupted. Delete this document and upload it again.",
    })
    .where(
      and(
        eq(documents.status, "processing"),
        lt(documents.updatedAt, new Date(Date.now() - STALE_AFTER_MS)),
      ),
    );
}
