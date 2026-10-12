import type { ChunkBox } from "@/lib/db/schema";
import type { Block } from "./types";
import { clauseNumber, sentenceRanges, wordCount } from "./text";

export const MIN_WORDS = 50;
export const MAX_WORDS = 150;

export type ChunkDraft = {
  text: string;
  heading: string | null;
  clause: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  wordCount: number;
  boxes: ChunkBox[];
  /** DOCX: indexes of the HTML elements this chunk covers. */
  elementIndexes: number[];
};

/** A slice [start, end) of one block's text. */
type Unit = { block: Block; blockId: number; start: number; end: number; words: number };

/** Numeric clauses ("12.", "12.1") start a new chunk; lettered sub-clauses may merge. */
const NUMERIC_CLAUSE = /^\d{1,3}(\.\d{1,3})*\.?(\s|$)/;

export function chunkBlocks(blocks: Block[]): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let parts: Unit[] = [];
  let headingParts: string[] = [];
  let sectionHeading: string | null = null;

  const words = () => parts.reduce((n, u) => n + u.words, 0);
  const hasBody = () => parts.some((u) => !u.block.heading);

  const flush = () => {
    if (parts.length) chunks.push(build(parts, sectionHeading));
    parts = [];
  };

  blocks.forEach((block, blockId) => {
    if (block.heading) {
      // A heading closes the previous chunk and opens the next one.
      if (hasBody()) {
        flush();
        headingParts = [];
      }
      headingParts.push(block.text);
      sectionHeading = headingParts.join(" ");
      parts.push({ block, blockId, start: 0, end: block.text.length, words: wordCount(block.text) });
      return;
    }
    headingParts = [];

    for (const unit of splitBlock(block, blockId)) {
      const startsClause = NUMERIC_CLAUSE.test(block.text.slice(unit.start));
      const fits = words() + unit.words <= MAX_WORDS;
      const canMerge =
        parts.length > 0 && fits && (!hasBody() || (words() < MIN_WORDS && !startsClause));
      if (!canMerge) flush();
      parts.push(unit);
    }
  });
  flush();
  return chunks;
}

/** Split a block longer than MAX_WORDS at sentence ends (or, failing that, at ; and ,). */
function splitBlock(block: Block, blockId: number): Unit[] {
  const total = wordCount(block.text);
  if (total <= MAX_WORDS) {
    return [{ block, blockId, start: 0, end: block.text.length, words: total }];
  }

  const pieces: [number, number][] = [];
  for (const [s, e] of sentenceRanges(block.text)) {
    if (wordCount(block.text.slice(s, e)) <= MAX_WORDS) pieces.push([s, e]);
    else pieces.push(...splitLongSentence(block.text, s, e));
  }

  // Greedily pack consecutive pieces up to MAX_WORDS.
  const units: Unit[] = [];
  for (const [s, e] of pieces) {
    const w = wordCount(block.text.slice(s, e));
    const last = units[units.length - 1];
    if (last && last.words + w <= MAX_WORDS) {
      last.end = e;
      last.words += w;
    } else {
      units.push({ block, blockId, start: s, end: e, words: w });
    }
  }
  return units;
}

/** Legal sentences can run for 300 words. Break at "; " then ", " then on words. */
function splitLongSentence(text: string, start: number, end: number): [number, number][] {
  for (const sep of [/;\s+/g, /,\s+/g, /\s+/g]) {
    const cuts = [start];
    let lastCut = start;
    sep.lastIndex = start;
    let m: RegExpExecArray | null;
    while ((m = sep.exec(text)) && m.index < end) {
      const cut = m.index + m[0].length;
      if (wordCount(text.slice(lastCut, cut)) >= MAX_WORDS * 0.8) {
        cuts.push(cut);
        lastCut = cut;
      }
    }
    cuts.push(end);
    const ranges = cuts.slice(1).map((c, i) => [cuts[i], c] as [number, number]);
    if (ranges.every(([s, e]) => wordCount(text.slice(s, e)) <= MAX_WORDS)) return ranges;
  }
  return [[start, end]];
}

function build(parts: Unit[], heading: string | null): ChunkDraft {
  let text = "";
  const boxes: ChunkBox[] = [];
  const elementIndexes = new Set<number>();

  parts.forEach((u, i) => {
    const raw = u.block.text.slice(u.start, u.end);
    const lead = raw.length - raw.trimStart().length;
    const piece = raw.trim();
    const sameBlock = i > 0 && parts[i - 1].blockId === u.blockId;
    const sep = i === 0 ? "" : sameBlock ? " " : "\n\n";
    const offset = text.length + sep.length;
    text += sep + piece;

    const from = u.start + lead;
    const to = from + piece.length;
    for (const l of u.block.lines) {
      if (l.end <= from || l.start >= to) continue;
      boxes.push({
        page: l.page,
        x0: round(l.x0),
        y0: round(l.y0),
        x1: round(l.x1),
        y1: round(l.y1),
        start: offset + Math.max(l.start, from) - from,
        end: offset + Math.min(l.end, to) - from,
      });
    }
    if (u.block.elementIndex !== undefined) elementIndexes.add(u.block.elementIndex);
  });

  const pages = boxes.map((b) => b.page);
  const body = parts.find((u) => !u.block.heading) ?? parts[0];
  return {
    text,
    heading,
    clause: clauseNumber(body.block.text.slice(body.start)),
    pageStart: pages.length ? Math.min(...pages) : null,
    pageEnd: pages.length ? Math.max(...pages) : null,
    wordCount: wordCount(text),
    boxes,
    elementIndexes: [...elementIndexes],
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
