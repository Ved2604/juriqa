import { type Unit, loose, normalize, similarity, withoutNumber } from "./units";

export type Pair = { old: Unit | null; new: Unit | null; order: number };

/** Minimum similarity for two clauses to count as the same clause, edited. */
const MATCH_MIN = 0.5;
/** A clause found elsewhere in the other version must be almost identical to count as moved. */
const MOVED_MIN = 0.8;

/**
 * Match clauses between two versions, the way a diff does: an order-preserving
 * alignment that maximises total text similarity. Clause numbers are not used
 * for matching, because removing one section renumbers everything after it;
 * matching by number would then pair unrelated clauses.
 *
 * Afterwards:
 *   - unmatched clauses that are near-identical elsewhere are paired as moved;
 *   - an unmatched old/new pair with the same number in the same gap is one
 *     clause whose text was replaced, not a removal plus an addition.
 * Everything left is removed (old only) or added (new only).
 */
export function alignUnits(oldUnits: Unit[], newUnits: Unit[]): Pair[] {
  const n = oldUnits.length;
  const m = newUnits.length;
  const oldWords = oldUnits.map((u) => loose(u.text));
  const newWords = newUnits.map((u) => loose(u.text));
  // Word sets computed once: the alignment compares every old clause with every new one.
  const oldSets = oldWords.map((w) => new Set(w.split(" ").filter(Boolean)));
  const newSets = newWords.map((w) => new Set(w.split(" ").filter(Boolean)));

  // Score of pairing old i with new j: Dice similarity of word sets, or -1 if too different to pair.
  const score = (i: number, j: number) => {
    if (oldWords[i] === newWords[j]) return 1;
    const a = oldSets[i];
    const b = newSets[j];
    if (!a.size || !b.size) return -1;
    // Cheap bound: sets of very different sizes can't reach the threshold.
    if ((2 * Math.min(a.size, b.size)) / (a.size + b.size) < MATCH_MIN) return -1;
    let common = 0;
    for (const w of a) if (b.has(w)) common++;
    const s = (2 * common) / (a.size + b.size);
    return s >= MATCH_MIN ? s : -1;
  };

  // dp[i][j] = best total score aligning the first i old and first j new clauses.
  const width = m + 1;
  const dp = new Float64Array((n + 1) * width);
  const move = new Uint8Array((n + 1) * width); // 1 = pair, 2 = skip old, 3 = skip new
  for (let i = 1; i <= n; i++) move[i * width] = 2;
  for (let j = 1; j <= m; j++) move[j] = 3;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      let best = dp[(i - 1) * width + j];
      let how = 2;
      if (dp[i * width + j - 1] > best) {
        best = dp[i * width + j - 1];
        how = 3;
      }
      const s = score(i - 1, j - 1);
      if (s >= 0 && dp[(i - 1) * width + j - 1] + s > best) {
        best = dp[(i - 1) * width + j - 1] + s;
        how = 1;
      }
      dp[i * width + j] = best;
      move[i * width + j] = how;
    }
  }

  const matchOf = new Map<Unit, Unit>(); // old -> new
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const how = move[i * width + j];
    if (how === 1) {
      matchOf.set(oldUnits[i - 1], newUnits[j - 1]);
      i--;
      j--;
    } else if (how === 2) i--;
    else j--;
  }
  const usedNew = new Set(matchOf.values());

  // Moved clauses: near-identical text in a different position.
  const restNew = () => newUnits.filter((u) => !usedNew.has(u));
  for (const o of oldUnits) {
    if (matchOf.has(o)) continue;
    let best: Unit | null = null;
    let bestScore = MOVED_MIN;
    for (const u of restNew()) {
      const s = withoutNumber(o.text) === withoutNumber(u.text) ? 1 : similarity(o.text, u.text);
      if (s >= bestScore) {
        best = u;
        bestScore = s;
      }
    }
    if (best) {
      matchOf.set(o, best);
      usedNew.add(best);
    }
  }

  // Replaced clauses: same number, sitting between the same matched neighbours.
  const anchorBefore = (units: Unit[], index: number, matched: (u: Unit) => Unit | undefined) => {
    for (let k = index - 1; k >= 0; k--) {
      const partner = matched(units[k]);
      if (partner) return partner.order;
    }
    return -1;
  };
  const newToOld = () => new Map([...matchOf].map(([o, nu]) => [nu, o]));
  for (const o of oldUnits) {
    if (matchOf.has(o) || !o.key) continue;
    const gapStart = anchorBefore(oldUnits, o.order, (u) => matchOf.get(u));
    const reverse = newToOld();
    const candidate = restNew().find(
      (u) => u.key === o.key && anchorBefore(newUnits, u.order, (x) => (reverse.has(x) ? x : undefined)) === gapStart,
    );
    if (candidate) {
      matchOf.set(o, candidate);
      usedNew.add(candidate);
    }
  }

  // Order: follow the new version; removed clauses sit after the last matched clause before them.
  const pairs: Pair[] = newUnits.map((u) => ({ old: null, new: u, order: u.order }));
  const byNew = new Map(pairs.map((p) => [p.new!, p]));
  let anchor = -1;
  let offset = 0;
  for (const o of oldUnits) {
    const partner = matchOf.get(o);
    if (partner) {
      byNew.get(partner)!.old = o;
      anchor = partner.order;
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
