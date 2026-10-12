"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { ClauseChange, Significance } from "@/lib/db/schema";

export const SIGNIFICANCE_LABEL: Record<Significance, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  cosmetic: "Cosmetic",
};

export const SIGNIFICANCE_STYLE: Record<Significance, string> = {
  high: "bg-danger-soft text-danger",
  medium: "bg-warning-soft text-warning",
  low: "bg-accent-soft text-accent",
  cosmetic: "bg-surface-2 text-muted",
};

const TYPE_LABEL = { modified: "Modified", added: "Added", removed: "Removed" } as const;

export function ChangeCard({ change: c }: { change: ClauseChange }) {
  const clause =
    c.oldClause && c.newClause && c.oldClause !== c.newClause
      ? `Clause ${c.oldClause} → ${c.newClause}`
      : c.newClause || c.oldClause
        ? `Clause ${c.newClause ?? c.oldClause}`
        : "Unnumbered text";

  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{clause}</span>
        {c.heading && <span className="truncate text-muted">{titleCase(c.heading)}</span>}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <span className="rounded-full border border-line px-2 py-0.5 text-muted">{TYPE_LABEL[c.type]}</span>
          <span className={`rounded-full px-2 py-0.5 font-medium ${SIGNIFICANCE_STYLE[c.significance]}`}>
            {SIGNIFICANCE_LABEL[c.significance]}
          </span>
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed">{c.summary}</p>

      {!c.assessed && (
        <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-warning">
          <AlertTriangle className="size-3.5" /> Not assessed automatically; significance is a placeholder.
        </p>
      )}

      {c.numberChanges && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Figures changed:</span>
          {c.numberChanges.removed.map((f, i) => (
            <span key={`r${i}`} className="rounded bg-danger-soft px-1.5 py-0.5 text-danger line-through">
              {f}
            </span>
          ))}
          {c.numberChanges.removed.length > 0 && c.numberChanges.added.length > 0 && (
            <ArrowRight className="size-3 text-muted" />
          )}
          {c.numberChanges.added.map((f, i) => (
            <span key={`a${i}`} className="rounded bg-success-soft px-1.5 py-0.5 text-success">
              {f}
            </span>
          ))}
        </div>
      )}

      <div className={`mt-3 grid gap-3 ${c.oldText && c.newText ? "md:grid-cols-2" : ""}`}>
        {c.oldText && <ClauseText label="Original" pages={c.oldPages} text={c.oldText} />}
        {c.newText && <ClauseText label="Revised" pages={c.newPages} text={c.newText} />}
      </div>
    </article>
  );
}

function ClauseText({ label, pages, text }: { label: string; pages: [number, number] | null; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 600;
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2.5">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">
        {label}
        {pages && ` · p. ${pages[0]}${pages[1] !== pages[0] ? `–${pages[1]}` : ""}`}
      </p>
      <p className={`whitespace-pre-wrap text-[13px] leading-relaxed ${long && !expanded ? "line-clamp-6" : ""}`}>{text}</p>
      {long && (
        <button onClick={() => setExpanded((e) => !e)} className="mt-1 text-xs text-accent hover:underline">
          {expanded ? "Show less" : "Show full text"}
        </button>
      )}
    </div>
  );
}

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
