import Link from "next/link";
import type { ReactNode } from "react";
import { LegalFooter } from "./legal-footer";

export function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[var(--reader-bg)] text-[var(--reader-fg)] font-sans">
      <header className="mx-auto max-w-3xl px-5 pt-6 sm:px-10">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center font-serif text-2xl underline-offset-4 hover:underline"
        >
          Marginalia
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-16 pt-10 sm:px-10 sm:pt-16">
        <h1 className="font-serif text-4xl sm:text-5xl text-balance">
          {title}
        </h1>
        <p className="mt-4 text-sm text-[var(--reader-fg-soft)]">
          Last updated: <time dateTime="2026-10-26">26 October 2026</time>
        </p>
        <article className="mt-10 space-y-5 text-base leading-7 text-[var(--reader-fg-soft)] [&_h2]:pt-6 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:text-[var(--reader-fg)] [&_a]:underline [&_a]:underline-offset-4 [&_ul]:list-disc [&_ul]:space-y-3 [&_ul]:pl-5">
          {children}
        </article>
      </main>
      <LegalFooter />
    </div>
  );
}
