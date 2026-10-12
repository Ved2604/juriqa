import { Suspense } from "react";
import { ChunkInspector } from "@/components/inspector/chunk-inspector";

// Temporary: shows how a document was split into chunks. Replaced by the chat workspace in Phase 2.
export default function DocumentPage() {
  return (
    <Suspense>
      <ChunkInspector />
    </Suspense>
  );
}
