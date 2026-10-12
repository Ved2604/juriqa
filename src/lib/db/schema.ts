import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

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
    // Full-text search index over heading + text (English stemming: "terminate" matches "termination").
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(heading, '') || ' ' || text)`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.index] }),
    index("chunks_search_idx").using("gin", t.search),
  ],
);

export const chats = pgTable("chats", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatDocuments = pgTable(
  "chat_documents",
  {
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    // Position in the chat's document list; the AI sees documents as D1, D2, ...
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.documentId] })],
);

export type MessageRole = "user" | "assistant";
export type MessageStatus = "streaming" | "complete" | "stopped" | "error";
export type RouteType = "document" | "off_topic" | "general_knowledge" | "chitchat";

/** A chunk cited in an answer. `id` is the label the AI used, e.g. "D1-C87". */
export type Citation = {
  id: string;
  documentId: string;
  documentName: string;
  index: number;
  text: string;
  heading: string | null;
  clause: string | null;
  pageStart: number | null;
  pageEnd: number | null;
};

/** One step of the agent's work, shown under the answer ("Searched for ..."). */
export type TraceStep = {
  tool: string;
  label: string;
  ok: boolean;
  resultCount?: number;
};

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").$type<MessageRole>().notNull(),
    // Assistant text keeps the raw [D1-C87] markers; the UI turns them into citation chips.
    content: text("content").notNull(),
    status: text("status").$type<MessageStatus>().notNull().default("complete"),
    route: text("route").$type<RouteType>(),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    // IDs the AI cited that it never retrieved or that don't exist.
    invalidCitations: jsonb("invalid_citations").$type<string[]>().notNull().default([]),
    trace: jsonb("trace").$type<TraceStep[]>().notNull().default([]),
    // Chunk IDs whose text was sent to the model while answering (coverage, Phase 3).
    readChunks: jsonb("read_chunks").$type<string[]>().notNull().default([]),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_chat_idx").on(t.chatId, t.createdAt)],
);

export type DocumentRow = typeof documents.$inferSelect;
export type ChunkRow = typeof chunks.$inferSelect;
export type ChatRow = typeof chats.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
