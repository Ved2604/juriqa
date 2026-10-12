"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { scrollContainerTo } from "./scroll";

const htmlCache = new Map<string, Promise<string>>();

function loadHtml(documentId: string): Promise<string> {
  if (!htmlCache.has(documentId)) {
    const p = fetch(`/api/documents/${documentId}/html`).then((r) => {
      if (!r.ok) throw new Error();
      return r.text();
    });
    p.catch(() => htmlCache.delete(documentId));
    htmlCache.set(documentId, p);
  }
  return htmlCache.get(documentId)!;
}

/** Renders a Word document as HTML; highlights the elements tagged with the cited chunk. */
export function DocxViewer({
  documentId,
  highlight,
  zoom,
}: {
  documentId: string;
  highlight: { index: number; key: number } | null;
  zoom: number;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadHtml(documentId)
      .then((h) => !cancelled && setHtml(h))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    const root = body.current;
    if (!root || html === null) return;
    root.querySelectorAll(".docx-highlight").forEach((el) => el.classList.remove("docx-highlight"));
    if (!highlight) return;
    const targets = root.querySelectorAll<HTMLElement>(`[data-chunk~="${highlight.index}"]`);
    // Re-adding the class restarts the pulse animation.
    void root.offsetWidth;
    targets.forEach((el) => el.classList.add("docx-highlight"));
    const first = targets[0];
    if (first && scroller.current) {
      const top = first.getBoundingClientRect().top - scroller.current.getBoundingClientRect().top;
      scrollContainerTo(scroller.current, scroller.current.scrollTop + top - 96);
    }
  }, [html, highlight]);

  return (
    <div ref={scroller} className="h-full overflow-auto bg-surface-2 p-6">
      {error ? (
        <p className="text-center text-sm text-danger">This document could not be displayed.</p>
      ) : html === null ? (
        <p className="flex items-center justify-center gap-2 p-4 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading document…
        </p>
      ) : (
        <div
          ref={body}
          className="docx-page mx-auto max-w-[760px] bg-white px-10 py-12 text-[#1c1c1a] shadow-sm"
          style={{ fontSize: `${14 * zoom}px` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
