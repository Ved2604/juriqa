import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { gemini } from "@/lib/ai/gemini";
import { withRetry } from "@/lib/ai/retry";

async function check(fn: () => Promise<string>) {
  try {
    return { ok: true, detail: await fn() };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// Phase 0 smoke test: confirms the database and Gemini are reachable.
export async function GET() {
  await connection(); // always run at request time, never prerender
  const [database, ai] = await Promise.all([
    check(async () => {
      await db.execute(sql`select 1`);
      return "connected";
    }),
    check(async () => {
      let used = "";
      const res = await withRetry((m) => {
        used = m;
        return gemini().models.generateContent({ model: m, contents: "Reply with the single word: pong" });
      });
      return `${used}: ${res.text?.trim()}`;
    }),
  ]);

  return Response.json(
    { database, ai },
    { status: database.ok && ai.ok ? 200 : 503 },
  );
}
