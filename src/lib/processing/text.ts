// Text heuristics shared by the extractors and the chunker.

const CLAUSE_NUMBER =
  /^(\d{1,3}(\.\d{1,3})+\.?|\d{1,3}\.|\([a-z]{1,4}\)|\(\d{1,3}\)|[a-z]\)|(article|section|clause|schedule|annex|appendix|exhibit)\s+[\dIVXLC]+[.:]?)(?=\s|$)/i;

/** "12.", "12.1", "(a)", "(iii)", "Article 4" at the start of a line. */
export function startsWithClauseNumber(text: string): boolean {
  return CLAUSE_NUMBER.test(text.trim());
}

/** The clause number a text starts with, e.g. "9.2" or "(a)", if any. */
export function clauseNumber(text: string): string | null {
  const m = text.trim().match(CLAUSE_NUMBER);
  return m ? m[1].replace(/[.:]$/, "") : null;
}

/** Short lines in capitals ("LIMITATION OF LIABILITY", "12. TERMINATION"). */
export function isHeadingText(text: string): boolean {
  const t = text.trim();
  const words = t.split(/\s+/);
  if (words.length > 12 || t.length > 100) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  return letters === letters.toUpperCase();
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const ABBREVIATIONS =
  /\b(ltd|co|inc|corp|llc|plc|no|nos|art|arts|sec|secs|cl|para|paras|pp|p|e\.g|i\.e|etc|mr|mrs|ms|dr|vs|v|approx|st|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|u\.s|u\.k|u\.a\.e)\.$/i;

/**
 * Split text into sentences with Intl.Segmenter, then re-join pieces that were
 * split after an abbreviation ("Acme Ltd.") or a bare clause number ("12.").
 * Returns [start, end) ranges into the input so callers keep exact offsets.
 */
export function sentenceRanges(text: string): [number, number][] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const ranges: [number, number][] = [];
  for (const { index, segment } of segmenter.segment(text)) {
    const end = index + segment.length;
    const last = ranges[ranges.length - 1];
    if (last) {
      const prevText = text.slice(last[0], last[1]).trim();
      if (ABBREVIATIONS.test(prevText) || wordCount(prevText) < 3) {
        last[1] = end;
        continue;
      }
    }
    ranges.push([index, end]);
  }
  return ranges;
}
