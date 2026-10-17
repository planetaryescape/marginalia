"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MobileNav, SiteHeader } from "@/components/site-header";
import { useReaderSettings } from "@/lib/reader-settings";
import { useReaderTheme } from "@/lib/use-reader-theme";

/** Persistent chrome for every destination in the desk frame. */
export default function DeskLayout({ children }: { children: ReactNode }) {
  const { settings } = useReaderSettings();
  useReaderTheme(settings);
  const pathname = usePathname();

  return (
    <div className="desk-shell h-dvh flex flex-col overflow-hidden bg-[var(--reader-bg)] text-[var(--reader-fg)] font-sans">
      <SiteHeader />
      <div
        key={pathname}
        className="desk-route flex-1 min-h-0 overflow-y-auto overscroll-contain"
        data-route={pathname}
      >
        {children}
      </div>
      <MobileNav />
    </div>
  );
}
