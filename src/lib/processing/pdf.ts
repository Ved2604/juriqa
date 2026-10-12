import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { type Block, type BlockLine, ProcessingError, type ProgressFn } from "./types";
import { isHeadingText, startsWithClauseNumber } from "./text";

type Item = { str: string; x: number; y: number; w: number; size: number };

type Line = {
  page: number;
  text: string;
  x0: number;
  x1: number;
  baseline: number;
  size: number;
  pageHeight: number;
};

/** Pages with fewer non-space characters than this count as having no text. */
const MIN_PAGE_CHARS = 30;

export type PdfExtraction = {
  blocks: Block[];
  pageCount: number;
  /** Pages with images but no extractable text (scanned). */
  scannedPages: number[];
};

export async function extractPdf(data: Uint8Array, progress: ProgressFn): Promise<PdfExtraction> {
  let pdf;
  try {
    pdf = await getDocumentProxy(data);
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") {
      throw new ProcessingError("This PDF is password-protected. Remove the password and upload it again.");
    }
    throw new ProcessingError("This PDF could not be opened. The file may be damaged.");
  }

  const { OPS } = await getResolvedPDFJS();
  const imageOps = new Set<number>([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintImageXObjectRepeat,
  ]);

  const pageCount = pdf.numPages;
  const pages: Line[][] = [];
  const scannedPages: number[] = [];

  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p % 5 === 0 || p === pageCount) {
      await progress(`Extracting text (page ${p} of ${pageCount})`);
    }
    const page = await pdf.getPage(p);
    const [, , , top] = page.view;
    const content = await page.getTextContent();

    const items: Item[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const [a, b, , , e, f] = it.transform as number[];
      const size = it.height || Math.hypot(a, b) || 10;
      items.push({ str: it.str, x: e, y: f, w: it.width, size });
    }

    const lines = groupLines(items, p, top);
    pages.push(lines);

    const chars = lines.reduce((n, l) => n + l.text.replace(/\s/g, "").length, 0);
    if (chars < MIN_PAGE_CHARS) {
      // Distinguish a scanned page (has images) from a genuinely blank one.
      const ops = await page.getOperatorList();
      if (ops.fnArray.some((fn) => imageOps.has(fn))) scannedPages.push(p);
    }
    page.cleanup();
  }
  await pdf.loadingTask.destroy();

  const totalChars = pages.flat().reduce((n, l) => n + l.text.replace(/\s/g, "").length, 0);
  if (totalChars < MIN_PAGE_CHARS) {
    throw new ProcessingError(
      "This PDF has no readable text. It looks like a scanned image, and scanned documents are not supported. Upload a PDF with selectable text.",
    );
  }

  const kept = removeRepeatedMargins(pages);
  return { blocks: buildBlocks(kept), pageCount, scannedPages };
}

/** Group text items that share a baseline into lines, top to bottom. */
function groupLines(items: Item[], page: number, pageHeight: number): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - it.y) <= Math.max(2, 0.4 * Math.min(row[0].size, it.size))) {
      row.push(it);
    } else {
      rows.push([it]);
    }
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let text = "";
    let prevEnd = -Infinity;
    for (const it of row) {
      const gap = it.x - prevEnd;
      const needsSpace =
        text.length > 0 && gap > 0.15 * it.size && !/\s$/.test(text) && !/^\s/.test(it.str);
      text += (needsSpace ? " " : "") + it.str;
      prevEnd = it.x + it.w;
    }
    const size = Math.max(...row.map((i) => i.size));
    return {
      page,
      text: text.replace(/\s+/g, " ").trim(),
      x0: Math.min(...row.map((i) => i.x)),
      x1: Math.max(...row.map((i) => i.x + i.w)),
      baseline: row[0].y,
      size,
      pageHeight,
    };
  });
}

const PAGE_NUMBER =
  /^(page\s*)?[-–(]?\s*\d{1,4}\s*[-–)]?(\s*(of|\/)\s*\d{1,4})?$|^[ivxlc]{1,6}$/i;

/**
 * Drop running headers, footers and page numbers. A line in the top or bottom
 * 10% of the page is removed if it is a page number, or if the same text
 * (ignoring digits) repeats on at least 40% of pages. Without this, a quote
 * that crosses a page break would have "Page 12 of 150" in the middle of it.
 */
function removeRepeatedMargins(pages: Line[][]): Line[][] {
  const inMargin = (l: Line) => l.baseline > l.pageHeight * 0.9 || l.baseline < l.pageHeight * 0.1;
  const key = (l: Line) => l.text.toLowerCase().replace(/\d+/g, "#");

  const counts = new Map<string, number>();
  for (const lines of pages) {
    for (const k of new Set(lines.filter(inMargin).map(key))) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const repeatThreshold = Math.max(3, Math.ceil(pages.length * 0.4));

  return pages.map((lines) =>
    lines.filter((l) => {
      if (!inMargin(l)) return true;
      if (PAGE_NUMBER.test(l.text)) return false;
      return (counts.get(key(l)) ?? 0) < repeatThreshold;
    }),
  );
}

const ENDS_SENTENCE = /[.:;!?]["')\]]?$/;

/** Join lines into paragraphs using spacing, clause numbering and headings. */
function buildBlocks(pages: Line[][]): Block[] {
  const spacing = medianLineSpacing(pages);
  const blocks: Block[] = [];
  let current: { text: string; lines: BlockLine[]; heading: boolean } | null = null;
  let prev: Line | null = null;

  const flush = () => {
    if (current && current.text.trim()) blocks.push(current);
    current = null;
  };

  for (const line of pages.flat()) {
    const heading = isHeadingText(line.text);
    let newBlock = true;

    if (current && prev && !current.heading && !heading) {
      if (line.page === prev.page) {
        const gap = prev.baseline - line.baseline;
        const bigGap = gap > spacing * 1.45 || gap < 0;
        newBlock = bigGap || startsWithClauseNumber(line.text);
      } else {
        // Page break: continue the paragraph if the previous page ended mid-sentence.
        newBlock = ENDS_SENTENCE.test(prev.text) || startsWithClauseNumber(line.text);
      }
    }

    if (newBlock) {
      flush();
      current = { text: "", lines: [], heading };
    }
    const block = current!;
    // Keep hyphens at line ends ("non-\ncompete" -> "non-compete"); otherwise join with a space.
    const sep = block.text === "" || /-$/.test(block.text) ? "" : " ";
    const start = block.text.length + sep.length;
    block.text += sep + line.text;
    block.lines.push({
      page: line.page,
      x0: line.x0,
      x1: line.x1,
      y0: line.baseline - 0.25 * line.size,
      y1: line.baseline + 0.85 * line.size,
      start,
      end: block.text.length,
    });
    prev = line;
  }
  flush();
  return blocks;
}

function medianLineSpacing(pages: Line[][]): number {
  const gaps: number[] = [];
  for (const lines of pages) {
    for (let i = 1; i < lines.length; i++) {
      const g = lines[i - 1].baseline - lines[i].baseline;
      if (g > 0 && g < 60) gaps.push(g);
    }
  }
  if (!gaps.length) return 14;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}
