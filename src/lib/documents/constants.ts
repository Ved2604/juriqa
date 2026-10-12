// Shared by browser and server, so no server-only imports here.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const MIME_BY_KIND = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type UploadKind = keyof typeof MIME_BY_KIND;

export function kindFromName(name: string): UploadKind | null {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "pdf" || ext === "docx" ? ext : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const UNSUPPORTED_TYPE_MESSAGE =
  "Only PDF and Word (.docx) files are supported.";
