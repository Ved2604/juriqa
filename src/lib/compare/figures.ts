/**
 * Amounts, percentages, periods and dates in a clause, found by code so that a
 * change like "AED 100,000" -> "AED 1,000,000" can never be missed or
 * downplayed by the AI.
 */

const CURRENCY = String.raw`(?:AED|USD|EUR|GBP|SAR|QAR|INR|US\$|\$|£|€|dirhams?|dollars?|pounds?|euros?)`;
const UNIT = String.raw`(?:%|per\s?cent|percent|(?:business\s+|calendar\s+|working\s+)?(?:days?|weeks?|months?|years?|hours?))`;
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand|m|bn|k)\b)?`;

const FIGURE = new RegExp(
  [
    String.raw`${CURRENCY}\s?${NUMBER}`,
    String.raw`${NUMBER}\s?${CURRENCY}`,
    String.raw`${NUMBER}\s?(?:\(\s*${NUMBER}\s*\)\s?)?${UNIT}`,
    String.raw`\(\s*${NUMBER}\s*\)\s?${UNIT}`,
    String.raw`\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4}`,
    String.raw`\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}`,
    String.raw`\b(?:19|20)\d{2}\b`,
  ].join("|"),
  "gi",
);

/** References to other clauses are numbering, not substance: "clause 14", "Section 9.2(b)". */
const CROSS_REFERENCE =
  /\b(?:clauses?|sections?|articles?|schedules?|annex(?:es)?|appendix|appendices|paragraphs?|sub-clauses?)\s+[\d.]+(?:\s*\([a-z0-9]+\))*(?:\s*(?:and|or|to|-)\s*[\d.]+)?/gi;

export function extractFigures(text: string): string[] {
  const cleaned = text.replace(CROSS_REFERENCE, " ").replace(/^\s*[\d.]+\s/, " ");
  return (cleaned.match(FIGURE) ?? []).map(canonical);
}

function canonical(figure: string): string {
  return figure.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
}

const key = (f: string) => f.toLowerCase().replace(/[\s,]/g, "");

/** Figures present in one version but not the other, or null if they match. */
export function figureChanges(oldText: string | null, newText: string | null): { removed: string[]; added: string[] } | null {
  const before = extractFigures(oldText ?? "");
  const after = extractFigures(newText ?? "");
  const removed = diff(before, after);
  const added = diff(after, before);
  return removed.length || added.length ? { removed, added } : null;
}

/** Items in a that are not matched one-for-one in b. */
function diff(a: string[], b: string[]): string[] {
  const pool = b.map(key);
  const out: string[] = [];
  for (const item of a) {
    const i = pool.indexOf(key(item));
    if (i >= 0) pool.splice(i, 1);
    else out.push(item);
  }
  return out;
}
