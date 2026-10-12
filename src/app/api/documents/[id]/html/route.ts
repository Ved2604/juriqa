import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { parse } from "node-html-parser";
import { z } from "zod";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

const SAFE_HREF = /^(https?:|mailto:|#)/i;

/** The rendered HTML of a DOCX document, with each paragraph tagged by chunk (data-chunk). */
export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]/html">) {
  await connection();
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Document not found." }, { status: 404 });
  }
  const [doc] = await db.select({ html: documents.html }).from(documents).where(eq(documents.id, id));
  if (!doc?.html) return Response.json({ error: "No rendered HTML for this document." }, { status: 404 });

  // mammoth escapes text, but a crafted .docx can still carry javascript: links. Keep only safe ones.
  const root = parse(doc.html);
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href") ?? "";
    if (!SAFE_HREF.test(href.trim())) a.removeAttribute("href");
    else if (!href.startsWith("#")) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  }
  for (const el of root.querySelectorAll("*")) {
    for (const attr of Object.keys(el.attributes)) if (/^on/i.test(attr)) el.removeAttribute(attr);
  }
  return new Response(root.toString(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
