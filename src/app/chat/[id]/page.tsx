import { Suspense } from "react";
import { Workspace } from "@/components/chat/workspace";

export default function ChatPage() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
