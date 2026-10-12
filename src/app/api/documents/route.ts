import { after, connection } from "next/server";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { MAX_UPLOAD_BYTES, UNSUPPORTED_TYPE_MESSAGE, kindFromName } from "@/lib/documents/constants";
import { listColumns } from "@/lib/documents/queries";
import { expireStaleDocuments, processDocument } from "@/lib/processing/process";

// Processing runs in after(), which shares this route's time budget.
export const maxDuration = 300;

export async function GET() {
  await connection();
  await expireStaleDocuments();
  const rows = await db.select(listColumns).from(documents).orderBy(desc(documents.createdAt));
  return Response.json(rows);
}

const createSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1).max(255),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid upload details." }, { status: 400 });
  }
  const { url, name, size } = parsed.data;

  // Only accept files that were uploaded to our own Blob store.
  const host = new URL(url).hostname;
  if (!host.endsWith(".blob.vercel-storage.com")) {
    return Response.json({ error: "Invalid file location." }, { status: 400 });
  }
  const kind = kindFromName(name);
  if (!kind) return Response.json({ error: UNSUPPORTED_TYPE_MESSAGE }, { status: 400 });

  const [doc] = await db
    .insert(documents)
    .values({ name, kind, blobUrl: url, sizeBytes: size, step: "Queued" })
    .returning(listColumns);

  after(() => processDocument(doc.id));
  return Response.json(doc, { status: 201 });
}
