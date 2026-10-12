"use client";

import { useEffect } from "react";

/** Set the browser tab title for client-rendered pages. */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · Juriqa`;
  }, [title]);
}
