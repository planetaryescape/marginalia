"use client";
import DOMPurify, { type Config } from "dompurify";
import { useEffect, useState } from "react";

// DOMPurify needs a real DOM. isomorphic-dompurify brought in jsdom for server
// rendering, which crashes in Vercel's Node runtime, so HTML is only sanitised
// in the browser and server renders leave it out.

export function sanitizeHtml(html: string, config?: Config): string {
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(html, {
    ...config,
    RETURN_TRUSTED_TYPE: false,
  }) as string;
}

/** False during server rendering and the first client render, then true. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
