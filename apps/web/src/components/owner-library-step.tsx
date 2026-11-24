"use client";

import { useState } from "react";
import { OwnerSetupFrame } from "@/components/owner-setup-frame";

export type FirstLibraryChoice = "readwise" | "article" | "empty";

export function OwnerLibraryStep({
  onChoose,
}: {
  onChoose: (choice: FirstLibraryChoice) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function choose(choice: FirstLibraryChoice) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onChoose(choice);
    } catch {
      setError("Couldn't finish setup. Your progress is saved; try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <OwnerSetupFrame
      step="Step 3 of 3 · Your library"
      title="Bring something to read"
    >
      <p className="mb-6 text-sm text-[var(--reader-muted)]">
        Start with a library you already have, a link, or a PDF or EPUB. You can
        read without setting up AI. Integrations and invitations can wait.
      </p>
      <div className="space-y-3" aria-busy={busy}>
        <button
          className="app-button w-full"
          type="button"
          disabled={busy}
          onClick={() => choose("readwise")}
        >
          Import from Readwise Reader
        </button>
        <button
          className="app-button w-full"
          type="button"
          disabled={busy}
          onClick={() => choose("article")}
        >
          Add an article or book
        </button>
        <button
          className="min-h-11 w-full text-sm underline"
          type="button"
          disabled={busy}
          onClick={() => choose("empty")}
        >
          Start empty
        </button>
      </div>
      <p className="mt-5 text-sm text-[var(--reader-muted)]">
        Already have a library here? These choices won’t replace it.
      </p>
      {error && (
        <p role="alert" className="mt-4 text-sm">
          {error}
        </p>
      )}
    </OwnerSetupFrame>
  );
}
