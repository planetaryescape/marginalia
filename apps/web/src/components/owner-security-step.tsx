"use client";

import { useRef, useState } from "react";
import { OwnerSetupFrame } from "@/components/owner-setup-frame";

export type PasskeyEnrollment = { ok: true } | { ok: false; message: string };

export function OwnerSecurityStep({
  enroll,
  onContinue,
}: {
  enroll: () => Promise<PasskeyEnrollment>;
  onContinue: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enrolled, setEnrolled] = useState(false);
  const running = useRef(false);
  async function proceed(addPasskey: boolean) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      if (addPasskey && !enrolled) {
        const result = await enroll();
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setEnrolled(true);
      }
      await onContinue();
    } catch {
      setError("Couldn't save this step. Your account is safe; try again.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <OwnerSetupFrame
      step="Step 2 of 3 · Signing in"
      title="Make the next visit easier"
    >
      <p className="mb-4 text-sm text-[var(--reader-muted)]">
        Use your device or password manager to create a passkey for this reader.
        Passkeys are specific to this reader’s address.
      </p>
      <p className="mb-6 text-sm text-[var(--reader-muted)]">
        Keep the password you just chose in your password manager. It’s your
        fallback if you lose access to a passkey. There’s no email password
        reset.
      </p>
      <div className="space-y-3" aria-busy={busy}>
        <button
          type="button"
          className="app-button w-full"
          disabled={busy}
          onClick={() => proceed(true)}
        >
          {enrolled ? "Continue" : "Add a passkey"}
        </button>
        <button
          type="button"
          className="min-h-11 w-full text-sm underline"
          disabled={busy}
          onClick={() => proceed(false)}
        >
          Not now, continue with my password
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm">
          {error}
        </p>
      )}
    </OwnerSetupFrame>
  );
}
