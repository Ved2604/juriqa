import type { UploadKind } from "@/lib/documents/constants";

/**
 * Identify a file by its bytes rather than its name.
 * PDF files start with "%PDF-". DOCX files are zip archives; zip stores entry
 * names uncompressed, so a real Word file contains "word/document.xml".
 */
export function sniffKind(buf: Uint8Array): UploadKind | null {
  const head = new TextDecoder("latin1").decode(buf.subarray(0, 1024));
  if (head.includes("%PDF-")) return "pdf";

  const isZip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (isZip) {
    const all = new TextDecoder("latin1").decode(buf);
    if (all.includes("word/document.xml")) return "docx";
  }
  return null;
}
