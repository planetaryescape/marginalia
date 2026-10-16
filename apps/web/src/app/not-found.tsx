import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-5 px-6 bg-[var(--reader-bg)] text-[var(--reader-fg)] text-center">
      <h1 className="font-serif text-3xl">This page isn't here</h1>
      <p className="font-sans text-sm text-[var(--reader-muted)]">
        Return to your reading desk to find something to read.
      </p>
      <Link href="/" className="font-sans text-sm quiet-link">
        Back to Home
      </Link>
    </main>
  );
}
