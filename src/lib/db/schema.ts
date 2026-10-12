import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type DocumentKind = "pdf" | "docx";
export type DocumentStatus = "processing" | "ready" | "failed";

/**
 * A rectangle a chunk occupies on a PDF page, in PDF user space
 * (origin bottom-left, units = points). `start`/`end` are the character
 * offsets in the chunk text that this rectangle covers, so a sub-range of the
 * chunk (an excerpt) can be highlighted without re-extracting.
 */
export type ChunkBox = {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  start: number;
  end: number;
};

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind").$type<DocumentKind>().notNull(),
  blobUrl: text("blob_url").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: text("status").$type<DocumentStatus>().notNull().default("processing"),
  // Human-readable progress shown while processing, e.g. "Extracting text (page 40 of 150)".
  step: text("step"),
  // Shown when status = failed.
  error: text("error"),
  // Shown alongside a ready document, e.g. some pages were scanned images.
  warning: text("warning"),
  pageCount: integer("page_count"),
  // Pages that contain images but no extractable text. They count as unread for coverage.
  unreadablePages: jsonb("unreadable_pages").$type<number[]>().notNull().default([]),
  chunkCount: integer("chunk_count"),
  // DOCX only: rendered HTML with data-chunk attributes for the viewer.
  html: text("html"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chunks = pgTable(
  "chunks",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    text: text("text").notNull(),
    // Nearest section heading above this chunk, e.g. "LIMITATION OF LIABILITY".
    heading: text("heading"),
    // Clause number the chunk starts with, e.g. "9.2" or "(a)".
    clause: text("clause"),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    wordCount: integer("word_count").notNull(),
    boxes: jsonb("boxes").$type<ChunkBox[]>().notNull().default([]),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.index] })],
);

export type DocumentRow = typeof documents.$inferSelect;
export type ChunkRow = typeof chunks.$inferSelect;
