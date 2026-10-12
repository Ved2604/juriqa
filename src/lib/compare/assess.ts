import { ThinkingLevel, Type } from "@google/genai";
import { gemini } from "@/lib/ai/gemini";
import { withRetry } from "@/lib/ai/retry";
import type { ChangeType, Significance } from "@/lib/db/schema";

export type ChangeInput = {
  id: number;
  type: ChangeType;
  heading: string | null;
  clause: string | null;
  oldText: string | null;
  newText: string | null;
  figures: { removed: string[]; added: string[] } | null;
};

export type Assessment = { summary: string; significance: Significance };

const BATCH_CHARS = 14_000;
const CONCURRENCY = 4;
const MAX_CLAUSE_CHARS = 3_000;

const SYSTEM = `You compare two versions of a legal contract, one clause at a time, for a lawyer.
For each change, write a one or two sentence plain-English summary of what changed IN SUBSTANCE, naming old and new values where relevant (e.g. "Liability cap raised from AED 100,000 to AED 1,000,000 and now applies to both parties.").
For added or removed clauses, say what the clause provides and the effect of adding or removing it.

Rate significance:
- "high": changes money, liability, indemnities, termination rights, deadlines or notice periods, governing law or jurisdiction, scope of obligations, who bears a risk, or adds/removes a right or obligation.
- "medium": changes a procedure, condition or standard with real but limited practical effect.
- "low": a minor clarification with little practical effect.
- "cosmetic": wording, style, ordering or numbering changes with no change in meaning.

Rules: judge only from the texts given. A reworded sentence with the same meaning is "cosmetic". A change that only updates a cross-reference to another clause (e.g. "subject to clause 12" -> "subject to clause 14") is "low", unless other wording also changed. Rate identical kinds of change the same way every time. If figures changed, say so explicitly. Do not speculate beyond the text.`;

/** Assess changes in parallel batches. Changes whose batch fails are omitted from the map. */
export async function assessChanges(
  changes: ChangeInput[],
  onProgress: (done: number, total: number) => Promise<void> | void,
): Promise<Map<number, Assessment>> {
  const batches: ChangeInput[][] = [];
  let current: ChangeInput[] = [];
  let size = 0;
  for (const c of changes) {
    const len = (c.oldText?.length ?? 0) + (c.newText?.length ?? 0);
    if (current.length && size + len > BATCH_CHARS) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(c);
    size += len;
  }
  if (current.length) batches.push(current);

  const results = new Map<number, Assessment>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const out = await assessBatch(batch).catch((e) => {
        console.error("Comparison batch failed", e);
        return null;
      });
      if (out) for (const [id, a] of out) results.set(id, a);
      done += batch.length;
      await onProgress(done, changes.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return results;
}

async function assessBatch(batch: ChangeInput[]): Promise<Map<number, Assessment>> {
  const body = batch
    .map((c) => {
      const where = [c.clause ? `Clause ${c.clause}` : null, c.heading].filter(Boolean).join(" · ") || "Unnumbered text";
      const figures = c.figures
        ? `\nFigures changed (detected by code): removed [${c.figures.removed.join("; ")}], added [${c.figures.added.join("; ")}]`
        : "";
      return `### Change ${c.id} (${c.type}) - ${where}${figures}
OLD: ${c.oldText ? clip(c.oldText) : "(clause did not exist)"}
NEW: ${c.newText ? clip(c.newText) : "(clause removed)"}`;
    })
    .join("\n\n");

  // One retry for malformed JSON; withRetry already handles overload and quota.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await withRetry((model) =>
        gemini().models.generateContent({
          model,
          contents: body,
          config: {
            systemInstruction: SYSTEM,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER },
                  summary: { type: Type.STRING },
                  significance: { type: Type.STRING, enum: ["high", "medium", "low", "cosmetic"] },
                },
                required: ["id", "summary", "significance"],
              },
            },
          },
        }),
      );
      const parsed = JSON.parse(res.text ?? "[]") as { id: number; summary: string; significance: Significance }[];
      const ids = new Set(batch.map((c) => c.id));
      const out = new Map<number, Assessment>();
      for (const r of parsed) {
        if (ids.has(r.id) && r.summary && ["high", "medium", "low", "cosmetic"].includes(r.significance)) {
          out.set(r.id, { summary: r.summary.trim(), significance: r.significance });
        }
      }
      return out;
    } catch (e) {
      if (attempt >= 1) throw e;
    }
  }
}

const clip = (t: string) => (t.length > MAX_CLAUSE_CHARS ? `${t.slice(0, MAX_CLAUSE_CHARS)} [...]` : t);

/** A short overview of the substantive changes, written from the per-change summaries. */
export async function writeOverview(
  oldName: string,
  newName: string,
  items: { significance: Significance; where: string; summary: string }[],
): Promise<string> {
  if (!items.length) return "No differences were found between the two versions.";
  const list = items.map((i) => `- [${i.significance}] ${i.where}: ${i.summary}`).join("\n");
  const res = await withRetry((model) =>
    gemini().models.generateContent({
      model,
      contents: `Original: "${oldName}"\nRevised: "${newName}"\n\nChanges:\n${list}`,
      config: {
        systemInstruction:
          "Write a plain-English overview for a lawyer of what changed in substance between two versions of a contract. Output only 2 to 5 markdown bullet points, most important first, with no heading or introduction. Mention specific values. Group related changes. Do not mention cosmetic changes unless there is nothing else. Use only the changes listed.",
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    }),
  );
  return res.text?.trim() || "";
}
