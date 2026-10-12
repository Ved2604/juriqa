"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Trash2, XCircle } from "lucide-react";
import { formatBytes } from "@/lib/documents/constants";
import type { DocumentSummary } from "@/lib/documents/types";
import type { PendingUpload } from "./library";

function FileIcon({ kind }: { kind: "pdf" | "docx" }) {
  return (
    <div
      className={`flex size-9 shrink-0 flex-col items-center justify-center rounded-md text-[9px] font-semibold uppercase ${
        kind === "pdf" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"
      }`}
    >
      <FileText className="size-4" />
      {kind}
    </div>
  );
}

export function UploadingRow({ upload }: { upload: PendingUpload }) {
  const kind = upload.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
  return (
    <li className="flex items-center gap-3 px-4 py-3.5">
      <FileIcon kind={kind} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{upload.name}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 w-40 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
          <span className="text-xs text-muted">Uploading {Math.round(upload.progress)}%</span>
        </div>
      </div>
    </li>
  );
}

export function DocumentRow({ doc, onDelete }: { doc: DocumentSummary; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ready = doc.status === "ready";

  const meta = [
    doc.pageCount ? `${doc.pageCount} ${doc.pageCount === 1 ? "page" : "pages"}` : null,
    formatBytes(doc.sizeBytes),
    new Date(doc.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
  ]
    .filter(Boolean)
    .join(" · ");

  const title = <p className="truncate text-sm font-medium">{doc.name}</p>;

  return (
    <li className="group flex items-center gap-3 px-4 py-3.5">
      <FileIcon kind={doc.kind} />
      <div className="min-w-0 flex-1">
        {ready ? (
          <Link href={`/documents/${doc.id}`} className="block hover:text-accent">
            {title}
          </Link>
        ) : (
          title
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span>{meta}</span>
          <Status doc={doc} />
        </div>
        {doc.status === "failed" && doc.error && (
          <p className="mt-1.5 text-xs text-danger">{doc.error}</p>
        )}
        {ready && doc.warning && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {doc.warning}
          </p>
        )}
      </div>

      {confirming ? (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted">Delete?</span>
          <button
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              await onDelete();
              setDeleting(false);
              setConfirming(false);
            }}
            className="rounded-md bg-danger px-2 py-1 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-md px-2 py-1 hover:bg-surface-2"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="rounded-md p-1.5 text-muted opacity-60 hover:bg-surface-2 hover:text-danger group-hover:opacity-100"
          aria-label={`Delete ${doc.name}`}
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}

function Status({ doc }: { doc: DocumentSummary }) {
  if (doc.status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 text-accent">
        <Loader2 className="size-3 animate-spin" />
        {doc.step ?? "Processing"}…
      </span>
    );
  }
  if (doc.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <XCircle className="size-3" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-success">
      <CheckCircle2 className="size-3" />
      Ready
    </span>
  );
}
