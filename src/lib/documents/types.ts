import type { DocumentKind, DocumentStatus } from "@/lib/db/schema";

/** A document as the browser sees it (JSON from /api/documents). */
export type DocumentSummary = {
  id: string;
  name: string;
  kind: DocumentKind;
  sizeBytes: number;
  status: DocumentStatus;
  step: string | null;
  error: string | null;
  warning: string | null;
  pageCount: number | null;
  unreadablePages: number[];
  chunkCount: number | null;
  blobUrl: string;
  createdAt: string;
};
