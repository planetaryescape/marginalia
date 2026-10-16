"use client";
import Link from "next/link";
import { DeskPage } from "@/components/desk-page";

export default function DeskError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <DeskPage title="Couldn't load this page">
      <p role="alert" className="mb-6 text-sm text-[var(--reader-muted)]">
        Check your connection and try again. Your library hasn't been changed.
      </p>
      <div className="flex items-center gap-5 text-sm">
        <button
          type="button"
          onClick={reset}
          className="rounded-full px-5 py-2.5 bg-[var(--reader-fg)] text-[var(--reader-bg)]"
        >
          Try again
        </button>
        <Link href="/" className="quiet-link">
          Back to Desk
        </Link>
      </div>
    </DeskPage>
  );
}
