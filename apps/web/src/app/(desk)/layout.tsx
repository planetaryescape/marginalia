"use client";
import type { ReactNode } from "react";
import { MobileNav, SiteHeader, useSiteNav } from "@/components/site-header";
import { useReaderSettings } from "@/lib/reader-settings";
import { useReaderTheme } from "@/lib/use-reader-theme";

/** Persistent chrome for every destination in the main navigation. */
export default function DeskLayout({ children }: { children: ReactNode }) {
  const { settings } = useReaderSettings();
  useReaderTheme(settings);
  const nav = useSiteNav();

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-[var(--reader-bg)] text-[var(--reader-fg)] font-sans">
      <SiteHeader showPaste={false} />
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      <MobileNav items={nav} />
    </div>
  );
}
