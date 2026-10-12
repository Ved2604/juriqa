"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask } from "pdfjs-dist";
import { Loader2 } from "lucide-react";
import type { ChunkBox } from "@/lib/db/schema";
import { scrollContainerTo } from "./scroll";

let pdfjs: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  pdfjs ??= import("pdfjs-dist").then((m) => {
    // Copied into public/ by scripts/copy-pdf-worker.mjs.
    m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return m;
  });
  return pdfjs;
}

type Loaded = { pdf: PDFDocumentProxy; pages: PDFPageProxy[] };
const cache = new Map<string, Promise<Loaded>>();

function loadDocument(url: string): Promise<Loaded> {
  if (!cache.has(url)) {
    const p = loadPdfjs().then(async (m) => {
      const pdf = await m.getDocument({ url }).promise;
      const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
      return { pdf, pages };
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url)!;
}

export type PdfHighlight = { boxes: ChunkBox[]; key: number };

const GUTTER = 24;

export function PdfViewer({
  url,
  highlight,
  zoom,
  onPageChange,
}: {
  url: string;
  highlight: PdfHighlight | null;
  zoom: number;
  onPageChange?: (page: number, total: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadDocument(url)
      .then((l) => !cancelled && setLoaded(l))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [url]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Measure now: ResizeObserver only reports on the next paint, which can be delayed in background tabs.
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the widest page to the panel width, then apply zoom.
  const baseWidth = loaded ? Math.max(...loaded.pages.map((p) => p.getViewport({ scale: 1 }).width)) : 0;
  const scale = loaded && width ? ((width - GUTTER * 2) / baseWidth) * zoom : 0;

  // Scroll to the first highlighted box whenever a new highlight arrives or the scale settles.
  useEffect(() => {
    if (!highlight || !loaded || !scale || !highlight.boxes.length) return;
    const first = [...highlight.boxes].sort((a, b) => a.page - b.page || b.y1 - a.y1)[0];
    const pageEl = pageEls.current.get(first.page);
    const page = loaded.pages[first.page - 1];
    if (!pageEl || !page) return;
    const [, top] = page.getViewport({ scale }).convertToViewportPoint(first.x0, first.y1);
    if (scroller.current) scrollContainerTo(scroller.current, pageEl.offsetTop + top - 96);
  }, [highlight, loaded, scale]);

  // Report the page nearest the top of the panel.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !loaded || !onPageChange) return;
    const report = () => {
      const mid = el.scrollTop + el.clientHeight / 3;
      let current = 1;
      for (const [n, pageEl] of pageEls.current) if (pageEl.offsetTop <= mid && n > current) current = n;
      onPageChange(current, loaded.pages.length);
    };
    report();
    el.addEventListener("scroll", report, { passive: true });
    return () => el.removeEventListener("scroll", report);
  }, [loaded, onPageChange, scale]);

  return (
    <div ref={scroller} className="relative h-full overflow-auto bg-surface-2">
      {error ? (
        <p className="p-6 text-center text-sm text-danger">This PDF could not be displayed.</p>
      ) : !loaded || !scale ? (
        <p className="flex items-center justify-center gap-2 p-10 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading document…
        </p>
      ) : (
        <div className="flex flex-col items-center gap-4" style={{ padding: GUTTER }}>
          {loaded.pages.map((page, i) => (
            <Page
              key={i}
              page={page}
              scale={scale}
              boxes={highlight?.boxes.filter((b) => b.page === i + 1) ?? []}
              highlightKey={highlight?.key ?? 0}
              register={(el) => {
                if (el) pageEls.current.set(i + 1, el);
                else pageEls.current.delete(i + 1);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const Page = memo(function Page({
  page,
  scale,
  boxes,
  highlightKey,
  register,
}: {
  page: PDFPageProxy;
  scale: number;
  boxes: ChunkBox[];
  highlightKey: number;
  register: (el: HTMLDivElement | null) => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const viewport = useMemo(() => page.getViewport({ scale }), [page, scale]);

  // Only render pages near the viewport, so long documents stay fast.
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    const dpr = window.devicePixelRatio || 1;
    const c = canvas.current;
    c.width = Math.floor(viewport.width * dpr);
    c.height = Math.floor(viewport.height * dpr);
    let task: RenderTask | null = page.render({
      canvas: c,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    task.promise.catch(() => {}).finally(() => (task = null));
    return () => task?.cancel();
  }, [visible, page, viewport]);

  return (
    <div
      ref={(el) => {
        holder.current = el;
        register(el);
      }}
      className="relative shrink-0 bg-white shadow-sm"
      style={{ width: viewport.width, height: viewport.height }}
    >
      {visible && <canvas ref={canvas} className="absolute inset-0" style={{ width: "100%", height: "100%" }} />}
      {boxes.map((b, i) => {
        const r = toRect(viewport, b);
        return (
          <div
            key={`${highlightKey}-${i}`}
            className="pdf-highlight pointer-events-none absolute rounded-sm"
            style={{ left: r.x - 2, top: r.y - 1, width: r.w + 4, height: r.h + 2 }}
          />
        );
      })}
    </div>
  );
});

/** PDF user-space box -> CSS pixels on the rendered page (handles rotation via the viewport). */
function toRect(viewport: PageViewport, b: ChunkBox) {
  const [ax, ay] = viewport.convertToViewportPoint(b.x0, b.y0);
  const [bx, by] = viewport.convertToViewportPoint(b.x1, b.y1);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}
