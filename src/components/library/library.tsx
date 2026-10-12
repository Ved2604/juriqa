"use client";

import { useCallback, useEffect, useState } from "react";
import { upload } from "@vercel/blob/client";
import { AlertCircle, X } from "lucide-react";
import {
  MAX_UPLOAD_BYTES,
  MIME_BY_KIND,
  UNSUPPORTED_TYPE_MESSAGE,
  formatBytes,
  kindFromName,
} from "@/lib/documents/constants";
import type { DocumentSummary } from "@/lib/documents/types";
import { DocumentRow, UploadingRow } from "./document-row";
import { Dropzone } from "./dropzone";

export type PendingUpload = { key: string; name: string; size: number; progress: number };

const POLL_MS = 1500;

export function Library() {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [rejections, setRejections] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setDocs(await res.json());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll only while something is processing.
  const busy = docs?.some((d) => d.status === "processing") ?? false;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [busy, refresh]);

  async function handleFiles(files: File[]) {
    const problems: string[] = [];
    const accepted = files.filter((f) => {
      if (!kindFromName(f.name)) {
        problems.push(`“${f.name}”: ${UNSUPPORTED_TYPE_MESSAGE}`);
        return false;
      }
      if (f.size > MAX_UPLOAD_BYTES) {
        problems.push(`“${f.name}” is ${formatBytes(f.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
        return false;
      }
      if (f.size === 0) {
        problems.push(`“${f.name}” is empty.`);
        return false;
      }
      return true;
    });
    setRejections(problems);
    await Promise.all(accepted.map(uploadOne));
  }

  async function uploadOne(file: File) {
    const key = crypto.randomUUID();
    const kind = kindFromName(file.name)!;
    setPending((p) => [...p, { key, name: file.name, size: file.size, progress: 0 }]);
    try {
      const blob = await upload(`documents/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: MIME_BY_KIND[kind],
        multipart: file.size > 5 * 1024 * 1024,
        onUploadProgress: ({ percentage }) =>
          setPending((p) => p.map((u) => (u.key === key ? { ...u, progress: percentage } : u))),
      });
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: blob.url, name: file.name, size: file.size }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed.");
      }
      const doc: DocumentSummary = await res.json();
      setDocs((d) => [doc, ...(d ?? [])]);
    } catch (e) {
      setRejections((r) => [
        ...r,
        `“${file.name}” could not be uploaded. ${e instanceof Error ? e.message : ""}`.trim(),
      ]);
    } finally {
      setPending((p) => p.filter((u) => u.key !== key));
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (res.ok || res.status === 404) setDocs((d) => d?.filter((x) => x.id !== id) ?? null);
  }

  const isEmpty = docs !== null && docs.length === 0 && pending.length === 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Juriqa</h1>
        <p className="mt-1 text-sm text-muted">
          Upload a contract, ask questions about it, and get answers backed by quotes checked
          against the document.
        </p>
      </header>

      <Dropzone onFiles={handleFiles} />

      {rejections.length > 0 && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <ul className="flex-1 space-y-1">
            {rejections.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <button
            onClick={() => setRejections([])}
            className="rounded p-0.5 hover:bg-danger/10"
            aria-label="Dismiss"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Documents</h2>
          {docs && docs.length > 0 && (
            <span className="text-xs text-muted">
              {docs.length} {docs.length === 1 ? "document" : "documents"}
            </span>
          )}
        </div>

        {loadError && docs === null ? (
          <div className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-sm">
            <p className="text-danger">Couldn’t load your documents.</p>
            <button onClick={refresh} className="mt-2 text-accent hover:underline">
              Try again
            </button>
          </div>
        ) : docs === null ? (
          <ListSkeleton />
        ) : isEmpty ? (
          <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
            No documents yet. Upload a contract to get started.
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {pending.map((u) => (
              <UploadingRow key={u.key} upload={u} />
            ))}
            {docs.map((d) => (
              <DocumentRow key={d.id} doc={d} onDelete={() => handleDelete(d.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-4">
          <div className="size-9 animate-pulse rounded-md bg-surface-2" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
            <div className="h-2.5 w-1/5 animate-pulse rounded bg-surface-2" />
          </div>
        </li>
      ))}
    </ul>
  );
}
