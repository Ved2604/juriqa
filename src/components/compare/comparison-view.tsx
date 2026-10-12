"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, ArrowLeftRight, ArrowRight, Loader2, RotateCcw, XCircle } from "lucide-react";
import type { ClauseChange, ComparisonResult, DocumentStatus, Significance } from "@/lib/db/schema";
import { ChangeCard, SIGNIFICANCE_LABEL, SIGNIFICANCE_STYLE } from "./change-card";

type DocInfo = { id: string; name: string; kind: string; pageCount: number | null } | null;
type ComparisonData = {
  id: string;
  status: DocumentStatus;
  step: string | null;
  error: string | null;
  result: ComparisonResult | null;
  oldDocument: DocInfo;
  newDocument: DocInfo;
};

const LEVELS: Significance[] = ["high", "medium", "low", "cosmetic"];
const RANK: Record<Significance, number> = { high: 0, medium: 1, low: 2, cosmetic: 3 };
const POLL_MS = 1500;

export function ComparisonView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Significance | "all">("all");
  const [sort, setSort] = useState<"significance" | "document">("significance");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/comparisons/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status === 404 ? "This comparison no longer exists." : "Couldn’t load the comparison.");
        const body: ComparisonData = await res.json();
        if (cancelled) return;
        setData(body);
        if (body.status === "processing") timer = setTimeout(poll, POLL_MS);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn’t load the comparison.");
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  const changes = data?.result?.changes;
  const counts = useMemo(() => {
    const c: Record<Significance, number> = { high: 0, medium: 0, low: 0, cosmetic: 0 };
    for (const ch of changes ?? []) c[ch.significance]++;
    return c;
  }, [changes]);

  const visible = useMemo(() => {
    const list = (changes ?? []).filter((c) => filter === "all" || c.significance === filter);
    return sort === "significance"
      ? [...list].sort((a, b) => RANK[a.significance] - RANK[b.significance] || a.order - b.order)
      : [...list].sort((a, b) => a.order - b.order);
  }, [changes, filter, sort]);

  async function start(oldId: string, newId: string, rerun: boolean) {
    setBusy(true);
    const res = await fetch("/api/comparisons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldDocumentId: oldId, newDocumentId: newId, rerun }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      if (body.id === id) window.location.reload();
      else router.push(`/compare/${body.id}`);
    } else setLoadError(body.error ?? "Couldn’t start the comparison.");
  }

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-sm">
        <p className="text-danger">{loadError}</p>
        <Link href="/" className="text-accent hover:underline">
          Back to documents
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading comparison…
      </div>
    );
  }

  const { oldDocument: oldDoc, newDocument: newDoc, result } = data;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Documents
      </Link>

      <header className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Compare versions</h1>
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2 text-sm sm:basis-auto">
          <DocTag label="Original" name={oldDoc?.name} />
          <ArrowRight className="size-4 shrink-0 text-muted" />
          <DocTag label="Revised" name={newDoc?.name} />
        </div>
        {oldDoc && newDoc && data.status !== "processing" && (
          <div className="flex gap-2">
            <button
              onClick={() => start(newDoc.id, oldDoc.id, false)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-50"
              title="Treat the other document as the original"
            >
              <ArrowLeftRight className="size-3.5" /> Swap
            </button>
            <button
              onClick={() => start(oldDoc.id, newDoc.id, true)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" /> Run again
            </button>
          </div>
        )}
      </header>

      {data.status === "processing" && (
        <div className="mt-10 flex flex-col items-center gap-2 rounded-xl border border-line bg-surface py-14 text-sm">
          <Loader2 className="size-5 animate-spin text-accent" />
          <p className="font-medium">{data.step ?? "Working"}…</p>
          <p className="text-xs text-muted">Matching clauses between the versions and assessing what changed.</p>
        </div>
      )}

      {data.status === "failed" && (
        <div className="mt-8 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{data.error}</span>
        </div>
      )}

      {data.status === "ready" && result && (
        <>
          <section className="mt-6 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-medium">What changed in substance</h2>
            {result.overview ? (
              <div className="answer mt-2 text-sm leading-relaxed">
                <ReactMarkdown>{result.overview}</ReactMarkdown>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">The overview could not be generated. The individual changes are listed below.</p>
            )}
            <p className="mt-4 text-xs text-muted">
              {result.changes.length} {result.changes.length === 1 ? "clause" : "clauses"} changed · {result.unchanged}{" "}
              unchanged
              {result.unassessed > 0 && (
                <span className="text-warning"> · {result.unassessed} could not be assessed automatically</span>
              )}
            </p>
          </section>

          {result.changes.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
                All <span className="opacity-60">{result.changes.length}</span>
              </FilterChip>
              {LEVELS.map((level) => (
                <FilterChip
                  key={level}
                  active={filter === level}
                  onClick={() => setFilter(level)}
                  disabled={!counts[level]}
                  className={filter === level ? SIGNIFICANCE_STYLE[level] : ""}
                >
                  {SIGNIFICANCE_LABEL[level]} <span className="opacity-60">{counts[level]}</span>
                </FilterChip>
              ))}
              <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                Sort
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg"
                >
                  <option value="significance">Most significant first</option>
                  <option value="document">Document order</option>
                </select>
              </label>
            </div>
          )}

          <ul className="mt-4 space-y-3">
            {visible.map((c: ClauseChange) => (
              <li key={c.id}>
                <ChangeCard change={c} />
              </li>
            ))}
          </ul>
          {result.changes.length === 0 && (
            <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
              The two versions are identical, clause for clause.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function DocTag({ label, name }: { label: string; name?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className="truncate font-medium">{name ?? "Deleted document"}</span>
    </span>
  );
}

function FilterChip({
  active,
  onClick,
  disabled,
  className = "",
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40 ${
        active ? `border-transparent font-medium ${className || "bg-fg text-bg"}` : "border-line bg-surface hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}
