"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  BadgeCheck,
  ChevronRight,
  CircleSlash,
  Loader2,
  RotateCcw,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { CITATION_GROUP, citedIds, expandGroup } from "@/lib/chat/events";
import type { SelectedCitation, UiMessage } from "@/lib/chat/client-types";
import type { Citation } from "@/lib/db/schema";
import { CoverageBadge } from "./coverage-badge";

export function UserMessage({ message }: { message: UiMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-sm">
        {message.content}
      </div>
    </div>
  );
}

export function AssistantMessage({
  message,
  multiDoc,
  selectedId,
  onSelect,
  onRetry,
}: {
  message: UiMessage;
  multiDoc: boolean;
  selectedId: string | null;
  onSelect: (s: SelectedCitation) => void;
  onRetry?: () => void;
}) {
  const ids = citedIds(message.content);
  const numberOf = (id: string) => ids.indexOf(id) + 1;
  const byId = new Map(message.citations.map((c) => [c.id, c]));
  const invalid = new Set(message.invalidCitations);
  const settled = message.status !== "streaming";
  const refused = message.route !== null && message.route !== "document";

  // Turn [D1-C87, D1-C90] into markdown links the renderer swaps for citation chips.
  const markdown = message.content.replace(CITATION_GROUP, (_, group: string) =>
    expandGroup(group)
      .map((id) => `[${numberOf(id)}](#cite-${id})`)
      .join(""),
  );

  const components: Components = {
    a: ({ href, children }) => {
      if (!href?.startsWith("#cite-")) {
        return (
          <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">
            {children}
          </a>
        );
      }
      const id = href.slice(6);
      const citation = byId.get(id);
      const letter = multiDoc ? docLetter(id) : null;
      if (citation) {
        return (
          <button
            onClick={() => onSelect({ citation, number: numberOf(id) })}
            className={`mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded px-1 align-middle text-[11px] font-semibold transition-colors ${
              selectedId === id ? "bg-accent text-white" : "bg-accent-soft text-accent hover:bg-accent hover:text-white"
            }`}
            title={`Verified passage${citation.clause ? ` · clause ${citation.clause}` : ""}${multiDoc ? ` · ${citation.documentName}` : ""}`}
          >
            {letter && <span className="mr-0.5 opacity-60">{letter}</span>}
            {children}
          </button>
        );
      }
      if (invalid.has(id) || settled) {
        return (
          <span
            className="mx-0.5 inline-flex h-[1.15rem] -translate-y-px items-center gap-0.5 rounded bg-danger-soft px-1 align-middle text-[11px] font-semibold text-danger line-through"
            title="Unverified: the AI cited a passage it never retrieved. Do not rely on this statement."
          >
            {children}
          </span>
        );
      }
      return (
        <span className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded bg-surface-2 px-1 align-middle text-[11px] font-semibold text-muted">
          {children}
        </span>
      );
    },
  };

  // An honest "not in the document" has nothing to cite; any other uncited answer is suspect.
  const noSupport =
    settled &&
    message.status === "complete" &&
    message.route === "document" &&
    message.content &&
    !message.citations.length &&
    message.coverage?.finding !== "not_found";

  return (
    <div className="space-y-3">
      {message.trace.length > 0 && <ResearchTrace message={message} />}

      {message.content ? (
        <div className={`answer text-sm leading-relaxed ${refused ? "text-muted" : ""}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {markdown}
          </ReactMarkdown>
        </div>
      ) : null}

      {message.status === "streaming" && (
        <p className="inline-flex items-center gap-2 text-xs text-muted">
          <Loader2 className="size-3.5 animate-spin" />
          {message.liveStatus ?? "Working"}…
        </p>
      )}

      {refused && (
        <p className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">
          <CircleSlash className="size-3.5" /> Outside the scope of your documents
        </p>
      )}

      {message.status === "stopped" && (
        <p className="inline-flex items-center gap-1.5 text-xs text-warning">
          <CircleSlash className="size-3.5" />
          {message.content ? "Stopped. The partial answer above was saved." : "Stopped before an answer was written."}
        </p>
      )}

      {message.status === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          <XCircle className="mt-px size-3.5 shrink-0" />
          <span className="flex-1">{message.error ?? "Something went wrong."}</span>
          {onRetry && (
            <button onClick={onRetry} className="inline-flex items-center gap-1 font-medium hover:underline">
              <RotateCcw className="size-3" /> Try again
            </button>
          )}
        </div>
      )}

      {message.invalidCitations.length > 0 && settled && (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <ShieldAlert className="mt-px size-3.5 shrink-0" />
          {message.invalidCitations.length === 1 ? "One citation" : `${message.invalidCitations.length} citations`} could
          not be verified against the document and {message.invalidCitations.length === 1 ? "is" : "are"} struck
          through. Treat the statements they support as unconfirmed.
        </p>
      )}

      {noSupport && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          This answer cites no passages from the document.
        </p>
      )}

      {settled && message.coverage && message.content && <CoverageBadge coverage={message.coverage} />}

      {message.citations.length > 0 && (
        <Sources
          citations={message.citations}
          numberOf={numberOf}
          multiDoc={multiDoc}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function ResearchTrace({ message }: { message: UiMessage }) {
  const [open, setOpen] = useState(false);
  const live = message.status === "streaming";
  const steps = message.trace;
  const shown = live || open ? steps : [];

  return (
    <div className="text-xs text-muted">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 hover:text-fg"
        disabled={live}
      >
        {!live && <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />}
        <Search className="size-3.5" />
        {live ? "Researching" : `Researched in ${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
      </button>
      {shown.length > 0 && (
        <ol className="mt-1.5 ml-1.5 space-y-1 border-l border-line pl-3">
          {shown.map((s, i) => (
            <li key={i} className={s.ok ? "" : "text-warning"}>
              {s.label}
              {s.ok && s.resultCount !== undefined && s.tool !== "list_clauses" && (
                <span className="text-muted/70">
                  {" "}
                  · {s.resultCount} {s.resultCount === 1 ? "passage" : "passages"}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Sources({
  citations,
  numberOf,
  multiDoc,
  selectedId,
  onSelect,
}: {
  citations: Citation[];
  numberOf: (id: string) => number;
  multiDoc: boolean;
  selectedId: string | null;
  onSelect: (s: SelectedCitation) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...citations].sort((a, b) => numberOf(a.id) - numberOf(b.id));
  const visible = expanded ? sorted : sorted.slice(0, SOURCES_COLLAPSED);
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">Sources ({sorted.length})</p>
      <ul className="space-y-1.5">
        {visible.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onSelect({ citation: c, number: numberOf(c.id) })}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                selectedId === c.id ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent/50"
              }`}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent">
                  {multiDoc && <span className="mr-0.5 opacity-60">{docLetter(c.id)}</span>}
                  {numberOf(c.id)}
                </span>
                <span className="truncate font-medium">{citationTitle(c, multiDoc)}</span>
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-success">
                  <BadgeCheck className="size-3.5" /> Verified
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted">{c.text.replace(/\s+/g, " ")}</p>
            </button>
          </li>
        ))}
      </ul>
      {sorted.length > SOURCES_COLLAPSED && (
        <button onClick={() => setExpanded((e) => !e)} className="mt-1.5 text-xs text-accent hover:underline">
          {expanded ? "Show fewer" : `Show all ${sorted.length} sources`}
        </button>
      )}
    </div>
  );
}

const SOURCES_COLLAPSED = 4;

/** "D2-C14" -> "B": a short tag for which document a citation comes from. */
export function docLetter(id: string): string {
  const n = Number(/^D(\d+)-/.exec(id)?.[1] ?? 1);
  return String.fromCharCode(64 + n);
}

export function citationTitle(c: Citation, multiDoc: boolean): string {
  const parts = [
    multiDoc ? c.documentName : null,
    c.clause ? `Clause ${c.clause}` : null,
    c.heading ? titleCase(c.heading) : null,
    c.pageStart ? `p. ${c.pageStart}${c.pageEnd && c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ""}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Passage";
}

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
