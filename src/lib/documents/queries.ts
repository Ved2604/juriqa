import { documents } from "@/lib/db/schema";

/** Columns returned to the browser for lists and status polling (no HTML body). */
export const listColumns = {
  id: documents.id,
  name: documents.name,
  kind: documents.kind,
  sizeBytes: documents.sizeBytes,
  status: documents.status,
  step: documents.step,
  error: documents.error,
  warning: documents.warning,
  pageCount: documents.pageCount,
  unreadablePages: documents.unreadablePages,
  chunkCount: documents.chunkCount,
  blobUrl: documents.blobUrl,
  createdAt: documents.createdAt,
};
