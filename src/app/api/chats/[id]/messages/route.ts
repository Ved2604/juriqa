import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { chats } from "@/lib/db/schema";
import { respond } from "@/lib/chat/respond";

// Research rounds plus streaming; Vercel's limit for the plan applies.
export const maxDuration = 300;

const bodySchema = z.object({ content: z.string().trim().min(1).max(4000) });

export async function POST(request: Request, ctx: RouteContext<"/api/chats/[id]/messages">) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Type a question first." }, { status: 400 });

  const [chat] = await db.select({ id: chats.id }).from(chats).where(eq(chats.id, id));
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });

  return new Response(respond(id, parsed.data.content), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
