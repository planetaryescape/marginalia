"use client";

import type { ReactNode } from "react";
import { LegalFooter } from "@/components/legal-footer";
import { SourceLink } from "@/components/source-link";

export function OwnerSetupFrame({
  step,
  title,
  children,
}: {
  step?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-screen bg-[var(--reader-bg)] text-[var(--reader-fg)]">
      <div className="w-full max-w-md">
        <p className="mb-8 font-serif text-2xl">Marginalia</p>
        {step && (
          <p className="mb-3 text-sm text-[var(--reader-muted)]">{step}</p>
        )}
        <h1 className="mb-4 font-serif text-3xl">{title}</h1>
        {children}
      </div>
      <SourceLink className="mt-10" />
      <LegalFooter />
    </main>
  );
}
