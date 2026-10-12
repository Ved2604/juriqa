import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import {
  MAX_UPLOAD_BYTES,
  MIME_BY_KIND,
  UNSUPPORTED_TYPE_MESSAGE,
  kindFromName,
} from "@/lib/documents/constants";

// Issues short-lived tokens so the browser can upload straight to Blob storage,
// bypassing Vercel's 4.5 MB request body limit.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!kindFromName(pathname)) throw new Error(UNSUPPORTED_TYPE_MESSAGE);
        return {
          allowedContentTypes: Object.values(MIME_BY_KIND),
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 400 },
    );
  }
}
