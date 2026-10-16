"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { DictionaryTab } from "@/components/reading-room/dictionary-tab";
import { StatsTab } from "@/components/reading-room/stats-tab";
import { useTabKeys } from "@/lib/list-nav";

const TABS = [
  { id: "stats", label: "Your reading", href: "/reading" },
  { id: "dictionary", label: "Dictionary", href: "/reading?tab=dictionary" },
] as const;

function ReadingRoom() {
  const tab =
    useSearchParams().get("tab") === "dictionary" ? "dictionary" : "stats";
  useTabKeys(TABS, tab);
  return (
    <main className="mx-auto w-full max-w-[1180px] px-5 md:px-10 pt-[clamp(0.75rem,4vh,3rem)] pb-10">
      <h1 className="mb-6 font-serif font-light tracking-tight text-[clamp(2rem,4vw,3.5rem)] leading-tight">
        Your reading
      </h1>
      <nav
        aria-label="Your reading"
        data-nav-tabs
        className="mb-7 flex gap-6 text-[15px]"
      >
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            replace
            aria-current={t.id === tab ? "page" : undefined}
            className={
              t.id === tab
                ? "font-medium text-[var(--reader-fg)] underline decoration-[var(--reader-border-strong)] underline-offset-8"
                : "text-[var(--reader-fg-soft)] hover:text-[var(--reader-fg)]"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "dictionary" ? <DictionaryTab /> : <StatsTab />}
    </main>
  );
}

export default function ReadingPage() {
  return (
    <Suspense fallback={null}>
      <ReadingRoom />
    </Suspense>
  );
}
