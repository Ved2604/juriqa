import { type Unit, loose, normalize, similarity, withoutNumber } from "./units";

export type Pair = { old: Unit | null; new: Unit | null; order: number };

/** Same clause number but this different: treat as two unrelated clauses (e.g. after renumbering). */
const SAME_NUMBER_MIN = 0.35;
/** Different number: only pair clauses whose wording is clearly the same clause. */
const MOVED_MIN = 0.6;

/**
 * Match clauses between two versions:
 *   1. same clause number and reasonably similar text,
 *   2. identical text under a different number (renumbered),
 *   3. most similar remaining text above a threshold.
 * Whatever is left is a removed (old only) or added (new only) clause.
 */
export function alignUnits(oldUnits: Unit[], newUnits: Unit[]): Pair[] {
  const matchOf = new Map<Unit, Unit>(); // old -> new
  const usedNew = new Set<Unit>();
  const pair = (o: Unit, n: Unit) => {
    matchOf.set(o, n);
    usedNew.add(n);
  };

  const newByKey = new Map<string, Unit[]>();
  for (const n of newUnits) if (n.key) newByKey.set(n.key, [...(newByKey.get(n.key) ?? []), n]);
  for (const o of oldUnits) {
    if (!o.key) continue;
    const candidate = newByKey.get(o.key)?.find((n) => !usedNew.has(n));
    if (candidate && similarity(o.text, candidate.text) >= SAME_NUMBER_MIN) pair(o, candidate);
  }

  const newByText = new Map<string, Unit[]>();
  for (const n of newUnits) {
    if (usedNew.has(n)) continue;
    const k = withoutNumber(n.text);
    newByText.set(k, [...(newByText.get(k) ?? []), n]);
  }
  for (const o of oldUnits) {
    if (matchOf.has(o)) continue;
    const candidate = newByText.get(withoutNumber(o.text))?.find((n) => !usedNew.has(n));
    if (candidate) pair(o, candidate);
  }

  // Greedy best-first on the remainder; documents rarely have many leftovers, so O(n*m) is fine.
  const restOld = oldUnits.filter((o) => !matchOf.has(o));
  const restNew = newUnits.filter((n) => !usedNew.has(n));
  const scored: { o: Unit; n: Unit; s: number }[] = [];
  for (const o of restOld) {
    for (const n of restNew) {
      const s = similarity(o.text, n.text);
      if (s >= MOVED_MIN) scored.push({ o, n, s });
    }
  }
  scored.sort((a, b) => b.s - a.s);
  for (const { o, n } of scored) if (!matchOf.has(o) && !usedNew.has(n)) pair(o, n);

  // A clause that kept its number but had its text replaced is one modified clause, not a removal plus an addition.
  for (const o of oldUnits) {
    if (matchOf.has(o) || !o.key) continue;
    const candidate = newByKey.get(o.key)?.find((n) => !usedNew.has(n));
    if (candidate) pair(o, candidate);
  }

  // Order: follow the new version; removed clauses sit after the last matched clause before them.
  const pairs: Pair[] = newUnits.map((n) => ({ old: null, new: n, order: n.order }));
  const byNew = new Map(pairs.map((p) => [p.new!, p]));
  let anchor = -1;
  let offset = 0;
  for (const o of oldUnits) {
    const n = matchOf.get(o);
    if (n) {
      byNew.get(n)!.old = o;
      anchor = n.order;
      offset = 0;
    } else {
      offset += 0.001;
      pairs.push({ old: o, new: null, order: anchor + offset });
    }
  }
  return pairs.sort((a, b) => a.order - b.order);
}

export type PairKind = "unchanged" | "renumbered" | "formatting" | "modified" | "added" | "removed";

/** Classify a pair by code alone; only "modified", "added" and "removed" need the AI. */
export function pairKind(p: Pair): PairKind {
  if (!p.old) return "added";
  if (!p.new) return "removed";
  if (normalize(p.old.text) === normalize(p.new.text)) return "unchanged";
  if (withoutNumber(p.old.text) === withoutNumber(p.new.text)) return "renumbered";
  if (loose(p.old.text) === loose(p.new.text)) return "formatting";
  return "modified";
}
