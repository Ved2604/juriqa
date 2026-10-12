"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, FileText, History, Loader2, MessageSquare, Plus } from "lucide-react";
import type { ChatData, ChatSummary, SelectedCitation, UiMessage } from "@/lib/chat/client-types";
import { Composer } from "./composer";
import { AssistantMessage, UserMessage } from "./message";
import { DocumentPanel } from "@/components/viewer/document-panel";
import { useChatStream } from "./use-chat-stream";
import { useTitle } from "@/lib/use-title";

const MULTI_SUGGESTIONS = [
  "How do the liability caps compare?",
  "Which agreement has the longer termination notice period?",
  "Compare the payment terms across these documents.",
  "What are the key differences between these documents?",
];

const SUGGESTIONS = [
  "What is the liability cap?",
  "How can this agreement be terminated?",
  "What are the payment terms?",
  "Is there a non-compete or non-solicitation clause?",
];

export function Workspace() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ChatData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [selected, setSelected] = useState<SelectedCitation | null>(null);
  // Small screens show the document as an overlay; large screens always show it beside the chat.
  const [panelOpen, setPanelOpen] = useState(false);
  const selectCitation = useCallback((s: SelectedCitation) => {
    setSelected(s);
    setPanelOpen(true);
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const { send, stop, streaming } = useChatStream(id, setMessages);
  useTitle(data ? (data.chat.title !== "New chat" ? data.chat.title : data.documents.map((d) => d.name).join(", ")) : null);

  const load = useCallback(async () => {
    const body = await fetchChat(id);
    setData(body);
    setMessages(body.messages);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    fetchChat(id)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setMessages(body.messages);
      })
      .catch((e) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Keep the newest content in view while answers stream in.
  const last = messages[messages.length - 1];
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, last?.content.length, last?.trace.length, last?.liveStatus, last?.status]);

  async function ask(question: string) {
    await send(question);
    // Re-sync with what the server saved (ids, citations validated after a stop).
    setTimeout(() => load().catch(() => {}), 1500);
  }

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-sm">
        <p className="text-danger">{loadError}</p>
        <Link href="/" className="text-accent hover:underline">
          Back to documents
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading chat…
      </div>
    );
  }

  const multiDoc = data.documents.length > 1;
  const docNames = data.documents.map((d) => d.name).join(", ");

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <Link href="/" className="flex items-center gap-1 text-sm text-muted hover:text-fg" aria-label="Back to documents">
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Documents</span>
        </Link>
        <div className="h-5 w-px bg-line" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={docNames}>
            {multiDoc ? `${data.documents.length} documents` : docNames}
            {multiDoc && <span className="ml-2 font-normal text-muted">{docNames}</span>}
          </p>
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg lg:hidden"
        >
          <FileText className="size-4" />
          <span className="hidden sm:inline">Document</span>
        </button>
        <ChatMenu chatId={id} documentId={data.documents[0]?.id} documentIds={data.documents.map((d) => d.id)} />
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div ref={scroller} className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6">
              {messages.length === 0 ? (
                <EmptyChat onPick={ask} documents={data.documents.map((d) => d.name)} />
              ) : (
                messages.map((m, i) =>
                  m.role === "user" ? (
                    <UserMessage key={m.id} message={m} />
                  ) : (
                    <AssistantMessage
                      key={m.id}
                      message={m}
                      multiDoc={multiDoc}
                      selectedId={selected?.citation.id ?? null}
                      onSelect={selectCitation}
                      onRetry={
                        i === messages.length - 1 && !streaming && messages[i - 1]?.role === "user"
                          ? () => ask(messages[i - 1].content)
                          : undefined
                      }
                    />
                  ),
                )
              )}
            </div>
          </div>
          <div className="mx-auto w-full max-w-2xl px-4 pb-4">
            <Composer
              onSend={ask}
              onStop={stop}
              streaming={streaming}
              placeholder={multiDoc ? "Ask a question across these documents…" : "Ask a question about this document…"}
            />
            <p className="mt-1.5 text-center text-[11px] text-muted">
              {multiDoc
                ? "Answers come only from these documents. Every citation is checked against its own document."
                : "Answers come only from the document. Every citation is checked against the text."}
            </p>
          </div>
        </main>

        <aside
          className={`${
            panelOpen ? "fixed inset-0 z-20 flex flex-col" : "hidden"
          } bg-surface lg:static lg:z-auto lg:flex lg:w-[48%] lg:max-w-3xl lg:flex-col lg:border-l lg:border-line`}
        >
          <DocumentPanel documents={data.documents} selected={selected} onClose={() => setPanelOpen(false)} />
        </aside>
      </div>
    </div>
  );
}

async function fetchChat(id: string): Promise<ChatData> {
  const res = await fetch(`/api/chats/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 404 ? "This chat no longer exists." : "Couldn’t load this chat.");
  return res.json();
}

function EmptyChat({ onPick, documents }: { onPick: (q: string) => void; documents: string[] }) {
  const multi = documents.length > 1;
  return (
    <div className="pt-10 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-accent-soft">
        <MessageSquare className="size-5 text-accent" />
      </div>
      <p className="text-sm font-medium">{multi ? `Ask across ${documents.length} documents` : "Ask anything about this contract"}</p>
      <p className="mt-1 text-xs text-muted">
        {multi
          ? "Answers compare the documents, and every citation is checked against its own document."
          : "Answers cite the exact passages they come from."}
      </p>
      {multi && (
        <ul className="mx-auto mt-4 max-w-sm space-y-1 text-left text-xs">
          {documents.map((name, i) => (
            <li key={name + i} className="flex items-center gap-2 truncate">
              <span className="flex size-4.5 shrink-0 items-center justify-center rounded bg-accent-soft text-[10px] font-semibold text-accent">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {(multi ? MULTI_SUGGESTIONS : SUGGESTIONS).map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-sm hover:border-accent/50 hover:bg-accent-soft"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatMenu({ chatId, documentId, documentIds }: { chatId: string; documentId?: string; documentIds: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || !documentId) return;
    fetch(`/api/chats?document=${documentId}`)
      .then((r) => r.json())
      .then(setChats)
      .catch(() => setChats([]));
  }, [open, documentId]);

  async function newChat() {
    setCreating(true);
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds }),
    });
    setCreating(false);
    if (res.ok) router.push(`/chat/${(await res.json()).id}`);
  }

  return (
    <div className="relative flex shrink-0 items-center gap-1 sm:gap-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
        aria-label="Chat history"
      >
        <History className="size-4 sm:hidden" />
        <span className="hidden sm:inline">History</span>
        <ChevronDown className="size-3.5" />
      </button>
      <button
        onClick={newChat}
        disabled={creating}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
        aria-label="New chat"
      >
        <Plus className="size-3.5" />
        <span className="hidden sm:inline">New chat</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-10 right-0 z-40 w-72 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
            <p className="border-b border-line px-3 py-2 text-xs font-medium text-muted">Chats for this document</p>
            <ul className="max-h-80 overflow-y-auto py-1">
              {chats === null ? (
                <li className="px-3 py-2 text-xs text-muted">Loading…</li>
              ) : chats.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted">No other chats yet.</li>
              ) : (
                chats.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/chat/${c.id}`}
                      onClick={() => setOpen(false)}
                      className={`block px-3 py-2 text-sm hover:bg-surface-2 ${c.id === chatId ? "font-medium text-accent" : ""}`}
                    >
                      <span className="block truncate">{c.title}</span>
                      <span className="text-[11px] text-muted">
                        {new Date(c.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
