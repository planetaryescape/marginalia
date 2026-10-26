"use client";
import type { ReturnEntry } from "@/lib/paragraph-return";

/**
 * Quiet pencil chip after a jump: returns the reader to where they were.
 * Positioned in globals.css, top centre on wide screens and above the bottom bar on phones.
 */
export function ReaderReturnChip({
  entry,
  onBack,
}: {
  entry: ReturnEntry | null;
  onBack: () => void;
}) {
  if (!entry) return null;
  return (
    <button
      type="button"
      onClick={onBack}
      title="Back (Backspace)"
      className="reader-return-chip reader-menu"
    >
      ↩ Back to ¶{entry.paragraph + 1}
    </button>
  );
}
