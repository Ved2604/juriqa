import { Suspense } from "react";
import { OpenDocument } from "@/components/chat/open-document";

// Opening a document goes to its most recent chat, or starts one.
export default function DocumentPage() {
  return (
    <Suspense>
      <OpenDocument />
    </Suspense>
  );
}
