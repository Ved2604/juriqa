"use client";

import { useState } from "react";
import { ChevronRight, ScanSearch, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Coverage, DocCoverage } from "@/lib/db/schema";
import { formatPages } from "@/lib/pages";

type Level = "full" | "targeted" | "incomplete";

function levelOf(d: DocCoverage): Level {
  if (d.failedPages.length || (d.full && d.scannedPages.length)) return "incomplete";
  return d.full ? "full" : "targeted";
}

const STYLE: Record<Level, string> = {
  full: "border-success/30 bg-success-soft text-success",
  targeted: "border-accent/25 bg-accent-soft text-accent",
  incomplete: "border-warning/30 bg-warning-soft text-warning",
};

/** Shows how much of each document was actually read for this answer. */
export function CoverageBadge({ coverage }: { coverage: Coverage }) {
  const [open, setOpen] = useState(false);
  const docs = coverage.documents;
  if (!docs.length) return null;

  const levels = docs.map(levelOf);
  const overall: Level = levels.includes("incomplete") ? "incomplete" : levels.every((l) => l === "full") ? "full" : "targeted";
  const Icon = overall === "full" ? ShieldCheck : overall === "incomplete" ? TriangleAlert : ScanSearch;

  const summary =
    docs.length === 1 ? singleSummary(docs[0], overall) : multiSummary(docs, levels);

  return (
    <div className={`rounded-lg border text-xs ${STYLE[overall]}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <Icon className="size-3.5 shrink-0" />
        <span className="flex-1 font-medium">{summary}</span>
        <ChevronRight className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-current/15 px-3 py-2 text-fg/80">
          {docs.map((d) => (
            <div key={d.documentId}>
              {docs.length > 1 && <p className="font-medium text-fg">{d.name}</p>}
              <p>
                Read {d.readChunks} of {d.totalChunks} passages
                {d.fullScan ? " (full document scan)" : " (targeted search)"}.
              </p>
              {!d.full && d.pagesRead.length > 0 && <p>{formatPages(d.pagesRead)} were read.</p>}
              {d.failedPages.length > 0 && (
                <p className="text-warning">{formatPages(d.failedPages)} could not be read due to an error.</p>
              )}
              {d.scannedPages.length > 0 && (
                <p className="text-warning">{formatPages(d.scannedPages)} are scanned images and were not read.</p>
              )}
            </div>
          ))}
          <p className="text-muted">
            {overall === "full"
              ? "Every passage was read, so a statement that something is absent covers the whole document."
              : overall === "targeted"
                ? "Only the passages above were read. The answer covers what was found, not the whole document."
                : "Parts of the document were not read, so the answer cannot rule out content on those pages."}
          </p>
        </div>
      )}
    </div>
  );
}

function singleSummary(d: DocCoverage, level: Level): string {
  if (level === "full") return "Full document reviewed";
  if (level === "incomplete") {
    const pages = [...d.failedPages, ...d.scannedPages].sort((a, b) => a - b);
    return `Incomplete: ${formatPages([...new Set(pages)]).toLowerCase()} not read`;
  }
  return `Targeted search: ${d.readChunks} of ${d.totalChunks} passages read`;
}

function multiSummary(docs: DocCoverage[], levels: Level[]): string {
  const full = levels.filter((l) => l === "full").length;
  if (full === docs.length) return `All ${docs.length} documents fully reviewed`;
  return `${full} of ${docs.length} documents fully reviewed`;
}
