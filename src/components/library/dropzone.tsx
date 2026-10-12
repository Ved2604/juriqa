"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { MAX_UPLOAD_BYTES, formatBytes } from "@/lib/documents/constants";

export function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={`flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
        over ? "border-accent bg-accent-soft" : "border-line bg-surface"
      }`}
    >
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2">
        <Upload className="size-5 text-muted" />
      </div>
      <p className="text-sm">
        Drop contracts here, or{" "}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="font-medium text-accent hover:underline"
        >
          browse
        </button>
      </p>
      <p className="mt-1 text-xs text-muted">
        PDF or Word (.docx), up to {formatBytes(MAX_UPLOAD_BYTES)}
      </p>
      <input
        ref={input}
        type="file"
        multiple
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
