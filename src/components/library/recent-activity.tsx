"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GitCompareArrows, Loader2, MessageSquare } from "lucide-react";

type RecentChat = { id: string; title: string; updatedAt: string; documents: string[] };
type RecentComparison = {
  id: string;
  status: "processing" | "ready" | "failed";
  createdAt: string;
  oldName: string;
  newName: string;
  changes: number | null;
  high: number | null;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Past chats and comparisons, so they can be reopened from the library. */
export function RecentActivity({ refreshKey }: { refreshKey: number }) {
  const [chats, setChats] = useState<RecentChat[] | null>(null);
  const [comparisons, setComparisons] = useState<RecentComparison[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/chats", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/comparisons", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([c, k]) => {
        if (cancelled) return;
        setChats(c);
        setComparisons(k);
      })
      .catch(() => {
        if (cancelled) return;
        setChats([]);
        setComparisons([]);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (chats === null || comparisons === null) return null;
  if (!chats.length && !comparisons.length) return null;

  return (
    <section className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="min-w-0">
        <h2 className="mb-3 text-sm font-medium">Recent chats</h2>
        {chats.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {chats.map((c) => (
              <li key={c.id}>
                <Link href={`/chat/${c.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                  <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{c.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {c.documents.length > 1 ? `${c.documents.length} documents` : c.documents[0]} · {when(c.updatedAt)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-muted">No chats yet.</p>
        )}
      </div>

      <div className="min-w-0">
        <h2 className="mb-3 text-sm font-medium">Comparisons</h2>
        {comparisons.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {comparisons.map((c) => (
              <li key={c.id}>
                <Link href={`/compare/${c.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                  <GitCompareArrows className="mt-0.5 size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {c.oldName} <span className="text-muted">→</span> {c.newName}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {c.status === "processing" ? (
                        <span className="inline-flex items-center gap-1 text-accent">
                          <Loader2 className="size-3 animate-spin" /> Comparing…
                        </span>
                      ) : c.status === "failed" ? (
                        <span className="text-danger">Failed</span>
                      ) : (
                        <>
                          {c.changes} {c.changes === 1 ? "change" : "changes"}
                          {c.high ? <span className="text-danger"> · {c.high} high</span> : null}
                        </>
                      )}{" "}
                      · {when(c.createdAt)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
            No comparisons yet. Tick two documents and choose “Compare versions”.
          </p>
        )}
      </div>
    </section>
  );
}
