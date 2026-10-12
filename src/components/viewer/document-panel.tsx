"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, FileText, Locate, Minus, Plus, X } from "lucide-react";
import type { ChatDocInfo, SelectedCitation } from "@/lib/chat/client-types";
import type { ChunkBox } from "@/lib/db/schema";
import { citationTitle } from "@/components/chat/message";
import { DocxViewer } from "./docx-viewer";
import { type PdfHighlight, PdfViewer } from "./pdf-viewer";

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2];

/** Right-hand panel: the real document with the cited passage highlighted, or the passage text alone. */
export function DocumentPanel({
  documents,
  selected,
  onClose,
}: {
  documents: ChatDocInfo[];
  selected: SelectedCitation | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"document" | "passage">("document");
  const [docId, setDocId] = useState(documents[0]?.id);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [pdfHighlight, setPdfHighlight] = useState<PdfHighlight | null>(null);
  const [docxHighlight, setDocxHighlight] = useState<{ index: number; key: number } | null>(null);
  const [page, setPage] = useState<{ current: number; total: number } | null>(null);

  const doc = documents.find((d) => d.id === docId) ?? documents[0];
  const zoom = ZOOMS[zoomIndex];

  // A new citation: switch to its document (adjusting state during render, per React's guidance).
  const [prevSelected, setPrevSelected] = useState(selected);
  if (selected !== prevSelected) {
    setPrevSelected(selected);
    const target = selected && documents.find((d) => d.id === selected.citation.documentId);
    if (target) {
      setDocId(target.id);
      setTab("document");
      if (target.kind === "docx") {
        setDocxHighlight((h) => ({ index: selected.citation.index, key: (h?.key ?? 0) + 1 }));
      }
    }
  }

  // PDF highlights need the passage's line boxes, fetched on demand.
  useEffect(() => {
    if (!selected) return;
    const target = documents.find((d) => d.id === selected.citation.documentId);
    if (target?.kind !== "pdf") return;
    let cancelled = false;
    fetch(`/api/documents/${target.id}/chunks?indexes=${selected.citation.index}`)
      .then((r) => r.json())
      .then((rows: { boxes: ChunkBox[] }[]) => {
        if (!cancelled) setPdfHighlight({ boxes: rows[0]?.boxes ?? [], key: Date.now() });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected, documents]);

  const relocate = () => {
    if (pdfHighlight) setPdfHighlight({ ...pdfHighlight, key: Date.now() });
    if (docxHighlight) setDocxHighlight({ ...docxHighlight, key: Date.now() });
  };

  const onPageChange = useCallback((current: number, total: number) => setPage({ current, total }), []);

  if (!doc) return null;
  const citationHere = selected && selected.citation.documentId === doc.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="flex rounded-md bg-surface-2 p-0.5 text-xs">
          {(["document", "passage"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              disabled={t === "passage" && !selected}
              className={`rounded px-2.5 py-1 capitalize disabled:opacity-40 ${
                tab === t ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {documents.length > 1 ? (
          <select
            value={doc.id}
            onChange={(e) => {
              setDocId(e.target.value);
              setTab("document");
            }}
            className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface px-2 py-1 text-xs"
          >
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-muted">
            <FileText className="size-3.5 shrink-0" />
            <span className="truncate">{doc.name}</span>
          </p>
        )}

        {tab === "document" && (
          <div className="flex items-center gap-0.5 text-xs text-muted">
            {doc.kind === "pdf" && page && (
              <span className="mr-1 tabular-nums">
                {page.current} / {page.total}
              </span>
            )}
            {citationHere && (
              <IconButton label="Back to highlighted passage" onClick={relocate}>
                <Locate className="size-3.5" />
              </IconButton>
            )}
            <IconButton label="Zoom out" onClick={() => setZoomIndex((z) => Math.max(0, z - 1))} disabled={zoomIndex === 0}>
              <Minus className="size-3.5" />
            </IconButton>
            <span className="w-9 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <IconButton
              label="Zoom in"
              onClick={() => setZoomIndex((z) => Math.min(ZOOMS.length - 1, z + 1))}
              disabled={zoomIndex === ZOOMS.length - 1}
            >
              <Plus className="size-3.5" />
            </IconButton>
          </div>
        )}
        <IconButton label="Close panel" onClick={onClose} className="lg:hidden">
          <X className="size-4" />
        </IconButton>
      </div>

      {selected && tab === "document" && citationHere && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-accent-soft px-3 py-1.5 text-xs text-accent">
          <span className="flex size-4 shrink-0 items-center justify-center rounded bg-accent text-[10px] font-semibold text-white">
            {selected.number}
          </span>
          <span className="truncate">{citationTitle(selected.citation, false)}</span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1">
            <BadgeCheck className="size-3.5" /> Verified
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {tab === "passage" && selected ? (
          <Passage selected={selected} />
        ) : doc.kind === "pdf" ? (
          <PdfViewer
            key={doc.id}
            url={doc.blobUrl}
            zoom={zoom}
            highlight={citationHere ? pdfHighlight : null}
            onPageChange={onPageChange}
          />
        ) : (
          <DocxViewer key={doc.id} documentId={doc.id} zoom={zoom} highlight={citationHere ? docxHighlight : null} />
        )}
      </div>
    </div>
  );
}

function Passage({ selected }: { selected: SelectedCitation }) {
  const { citation, number } = selected;
  return (
    <div className="h-full overflow-y-auto px-5 py-5">
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-accent text-[11px] font-semibold text-white">
          {number}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{citation.documentName}</p>
          <p className="text-xs text-muted">{citationTitle(citation, false)}</p>
        </div>
      </div>
      <p className="mb-3 inline-flex items-center gap-1.5 text-xs text-success">
        <BadgeCheck className="size-3.5" />
        Verified: this text is taken directly from the document.
      </p>
      <blockquote className="whitespace-pre-wrap rounded-lg border-l-4 border-accent bg-surface-2 px-4 py-3 text-sm leading-relaxed">
        {citation.text}
      </blockquote>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  className = "",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`rounded p-1 hover:bg-surface-2 hover:text-fg disabled:opacity-30 ${className}`}
    >
      {children}
    </button>
  );
}
