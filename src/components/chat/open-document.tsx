"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function OpenDocument() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await fetch(`/api/chats?document=${id}`).then((r) => (r.ok ? r.json() : []));
        let chatId: string | undefined = existing[0]?.id;
        if (!chatId) {
          const res = await fetch("/api/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documentIds: [id] }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? "Could not open this document.");
          chatId = body.id;
        }
        if (!cancelled) router.replace(`/chat/${chatId}`);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open this document.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  return (
    <div className="flex flex-1 items-center justify-center p-6 text-sm">
      {error ? (
        <div className="text-center">
          <p className="text-danger">{error}</p>
          <Link href="/" className="mt-2 inline-block text-accent hover:underline">
            Back to documents
          </Link>
        </div>
      ) : (
        <p className="inline-flex items-center gap-2 text-muted">
          <Loader2 className="size-4 animate-spin" /> Opening document…
        </p>
      )}
    </div>
  );
}
