"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatEvent } from "@/lib/chat/events";
import type { UiMessage } from "@/lib/chat/client-types";

const blankAssistant = (id: string): UiMessage => ({
  id,
  role: "assistant",
  content: "",
  status: "streaming",
  route: null,
  citations: [],
  invalidCitations: [],
  trace: [],
  error: null,
  liveStatus: "Sending",
});

/** Sends a question and applies the streamed events to the message list. */
export function useChatStream(chatId: string, setMessages: (fn: (m: UiMessage[]) => UiMessage[]) => void) {
  const [streaming, setStreaming] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const send = useCallback(
    async (content: string) => {
      const tempUser = `temp-user-${Date.now()}`;
      let assistantId = `temp-assistant-${Date.now()}`;
      const patch = (fn: (m: UiMessage) => UiMessage) =>
        setMessages((list) => list.map((m) => (m.id === assistantId ? fn(m) : m)));

      setMessages((list) => [
        ...list,
        { ...blankAssistant(tempUser), role: "user", content, status: "complete", liveStatus: undefined },
        blankAssistant(assistantId),
      ]);
      setStreaming(true);
      const ctrl = new AbortController();
      controller.current = ctrl;

      try {
        const res = await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Could not send your question.");
        }

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const event = JSON.parse(line) as ChatEvent;
            applyEvent(event);
          }
        }
      } catch (e) {
        if (ctrl.signal.aborted) {
          patch((m) => ({ ...m, status: "stopped", liveStatus: undefined }));
        } else {
          patch((m) => ({
            ...m,
            status: "error",
            liveStatus: undefined,
            error: e instanceof Error ? e.message : "Something went wrong.",
          }));
        }
      } finally {
        controller.current = null;
        setStreaming(false);
      }

      function applyEvent(event: ChatEvent) {
        switch (event.type) {
          case "start": {
            const oldId = assistantId;
            assistantId = event.assistantMessageId;
            setMessages((list) =>
              list.map((m) =>
                m.id === tempUser ? { ...m, id: event.userMessageId } : m.id === oldId ? { ...m, id: assistantId } : m,
              ),
            );
            break;
          }
          case "route":
            patch((m) => ({ ...m, route: event.route }));
            break;
          case "status":
            patch((m) => ({ ...m, liveStatus: event.text }));
            break;
          case "trace":
            patch((m) => ({ ...m, trace: [...m.trace, event.step] }));
            break;
          case "text":
            patch((m) => ({ ...m, content: m.content + event.delta, liveStatus: "Writing the answer" }));
            break;
          case "reset_text":
            patch((m) => ({ ...m, content: "" }));
            break;
          case "citations":
            patch((m) => ({ ...m, citations: event.citations, invalidCitations: event.invalid }));
            break;
          case "done":
            patch((m) => ({ ...m, status: event.status, error: event.error ?? null, liveStatus: undefined }));
            break;
        }
      }
    },
    [chatId, setMessages],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  return { send, stop, streaming };
}
