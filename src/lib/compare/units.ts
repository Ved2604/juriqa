import { clauseNumber } from "@/lib/processing/text";

/** A clause (or unnumbered paragraph group) of one document version. */
export type Unit = {
  /** Hierarchical clause number, e.g. "9.2" or "9.2(a)"; null for unnumbered text. */
  key: string | null;
  heading: string | null;
  /** Clause text as displayed (section heading removed). */
  text: string;
  pages: [number, number] | null;
  order: number;
};

export type UnitChunk = {
  index: number;
  text: string;
  heading: string | null;
  clause: string | null;
  pageStart: number | null;
  pageEnd: number | null;
};

/**
 * Group a document's chunks into clauses. A chunk that starts with a clause
 * number opens a new unit; continuation chunks (a long clause split in two)
 * join the unit before them. Lettered sub-clauses get their parent's number.
 */
export function buildUnits(chunks: UnitChunk[]): Unit[] {
  const units: Unit[] = [];
  let parent: string | null = null;

  for (const c of chunks) {
    const body = stripHeading(c.text, c.heading);
    const number = c.clause ?? clauseNumber(body);
    const current = units[units.length - 1];

    if (number || !current) {
      let key = number;
      if (number && /^\(/.test(number)) key = parent ? `${parent}${number}` : number;
      else if (number) parent = number;
      units.push({
        key,
        heading: c.heading,
        text: body,
        pages: c.pageStart && c.pageEnd ? [c.pageStart, c.pageEnd] : null,
        order: units.length,
      });
    } else {
      current.text += `\n\n${body}`;
      if (c.pageEnd && current.pages) current.pages = [current.pages[0], c.pageEnd];
      else if (c.pageStart && c.pageEnd) current.pages = [c.pageStart, c.pageEnd];
    }
  }
  return units.filter((u) => u.text.trim());
}

/** Chunk text begins with the section heading when a chunk opens a section; drop it. */
function stripHeading(text: string, heading: string | null): string {
  if (heading && text.startsWith(heading)) return text.slice(heading.length).trim();
  return text.trim();
}

/** Whitespace-normalised text: equal means unchanged. */
export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Text without its leading clause number, so renumbered clauses still compare equal. */
export function withoutNumber(text: string): string {
  const n = clauseNumber(text);
  return normalize(n ? text.trim().slice(text.trim().indexOf(n) + n.length).replace(/^[.:)\s]+/, "") : text);
}

/** Lowercase, no punctuation: equal means only formatting or punctuation changed. */
export function loose(text: string): string {
  return withoutNumber(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Dice similarity of the word sets of two texts (0..1). */
export function similarity(a: string, b: string): number {
  const wa = new Set(loose(a).split(" ").filter(Boolean));
  const wb = new Set(loose(b).split(" ").filter(Boolean));
  if (!wa.size && !wb.size) return 1;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return (2 * common) / (wa.size + wb.size);
}
