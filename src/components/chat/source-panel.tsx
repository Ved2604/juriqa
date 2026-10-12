"use client";

import { BadgeCheck, FileSearch, X } from "lucide-react";
import type { SelectedCitation } from "@/lib/chat/client-types";
import { citationTitle } from "./message";

export function SourcePanel({
  selected,
  onClose,
}: {
  selected: SelectedCitation | null;
  onClose: () => void;
}) {
  if (!selected) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2">
          <FileSearch className="size-5 text-muted" />
        </div>
        <p className="text-sm font-medium">Source passages</p>
        <p className="mt-1 max-w-xs text-xs text-muted">
          Click a numbered citation in an answer to see the exact passage it comes from.
        </p>
      </div>
    );
  }

  const { citation, number } = selected;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-accent text-[11px] font-semibold text-white">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{citation.documentName}</p>
          <p className="mt-0.5 text-xs text-muted">{citationTitle(citation, false)}</p>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <p className="mb-3 inline-flex items-center gap-1.5 text-xs text-success">
          <BadgeCheck className="size-3.5" />
          Verified: this text is taken directly from the document.
        </p>
        <blockquote className="whitespace-pre-wrap rounded-lg border-l-4 border-accent bg-surface-2 px-4 py-3 text-sm leading-relaxed">
          {citation.text}
        </blockquote>
      </div>
    </div>
  );
}
