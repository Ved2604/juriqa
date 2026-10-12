"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

export function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    const value = text.trim();
    if (!value || streaming || disabled) return;
    onSend(value);
    setText("");
  };

  return (
    <div className="flex items-end gap-2 rounded-xl border border-line bg-surface p-2 shadow-sm focus-within:border-accent/60">
      <textarea
        ref={ref}
        value={text}
        rows={1}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted disabled:opacity-50"
      />
      {streaming ? (
        <button
          onClick={onStop}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-fg text-bg hover:opacity-80"
          aria-label="Stop generating"
          title="Stop"
        >
          <Square className="size-3.5 fill-current" />
        </button>
      ) : (
        <button
          onClick={submit}
          disabled={!text.trim() || disabled}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-30"
          aria-label="Send"
        >
          <ArrowUp className="size-4" />
        </button>
      )}
    </div>
  );
}
