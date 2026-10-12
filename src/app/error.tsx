"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted">
        This page hit an unexpected error. Your documents and chats are safe.
      </p>
      <div className="flex gap-2">
        <button onClick={reset} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
          Try again
        </button>
        <Link href="/" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
          Back to documents
        </Link>
      </div>
    </div>
  );
}
