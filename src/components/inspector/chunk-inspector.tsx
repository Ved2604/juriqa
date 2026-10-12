"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { ChunkRow } from "@/lib/db/schema";
import type { DocumentSummary } from "@/lib/documents/types";

export function ChunkInspector() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentSummary | null>(null);
  const [chunks, setChunks] = useState<ChunkRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetch(`/api/documents/${id}`), fetch(`/api/documents/${id}/chunks`)])
      .then(async ([d, c]) => {
        if (!d.ok) throw new Error("Document not found.");
        setDoc(await d.json());
        setChunks(await c.json());
      })
      .catch((e) => setError(e.message));
  }, [id]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Documents
      </Link>
      {error && <p className="mt-6 text-sm text-danger">{error}</p>}
      {doc && (
        <header className="mt-4 mb-6">
          <h1 className="text-xl font-semibold">{doc.name}</h1>
          <p className="mt-1 text-sm text-muted">
            Chunk inspector · {doc.chunkCount ?? 0} chunks
            {doc.pageCount ? ` · ${doc.pageCount} pages` : ""}
          </p>
        </header>
      )}
      {chunks && (
        <ol className="space-y-3">
          {chunks.map((c) => (
            <li key={c.index} className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted">
                <span className="text-accent">C-{c.index}</span>
                {c.clause && <span>clause {c.clause}</span>}
                {c.heading && <span>§ {c.heading}</span>}
                {c.pageStart && (
                  <span>
                    p.{c.pageStart}
                    {c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ""}
                  </span>
                )}
                <span>{c.wordCount} words</span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
