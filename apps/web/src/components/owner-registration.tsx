"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AuthPasswordField } from "@/components/auth-password-field";
import { OwnerSetupFrame } from "@/components/owner-setup-frame";
import { authClient } from "@/lib/auth-client";
import {
  type RegistrationIssue,
  registrationFailure,
  registrationPasswordIssue,
} from "@/lib/auth-registration";

export function OwnerRegistration({
  token,
  onSignIn,
  onCreated,
}: {
  token: string;
  onSignIn: () => void;
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<RegistrationIssue | null>(null);
  const errorId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = String(fields.get("password") ?? "");
    const passwordIssue = registrationPasswordIssue(password);
    if (passwordIssue) {
      setIssue(passwordIssue);
      form.querySelector<HTMLInputElement>('[name="password"]')?.focus();
      return;
    }
    setBusy(true);
    setIssue(null);
    try {
      const result = await authClient.signUp.email({
        name: String(fields.get("name") ?? "").trim(),
        email: String(fields.get("email") ?? "").trim(),
        password,
        fetchOptions: { headers: { "x-reader-setup": token } },
      });
      if (result.error) {
        const failure = registrationFailure(result.error, "owner");
        setIssue(failure);
        if (failure.field)
          form
            .querySelector<HTMLInputElement>(`[name="${failure.field}"]`)
            ?.focus();
        return;
      }
      onCreated();
    } catch {
      setIssue({
        field: null,
        message:
          "Couldn't reach the registration service. Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <OwnerSetupFrame
      step="Step 1 of 3 · Owner account"
      title="Make this reader yours"
    >
      <p className="mb-6 text-sm text-[var(--reader-muted)]">
        You’ll own this reader. Only people you invite can create accounts.
        Choose a password to keep in your password manager; next, you can add a
        passkey.
      </p>
      <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
        <label className="block text-sm">
          Your name
          <input
            ref={nameRef}
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            className="app-input mt-2"
          />
        </label>
        <label className="block text-sm">
          Email
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="app-input mt-2"
            aria-invalid={issue?.field === "email" || undefined}
            aria-describedby={issue?.field === "email" ? errorId : undefined}
            onInput={() => setIssue(null)}
          />
        </label>
        <AuthPasswordField
          signingUp
          error={issue?.field === "password" ? issue.message : ""}
          onInput={() => setIssue(null)}
        />
        {issue && issue.field !== "password" && (
          <p id={errorId} role="alert" className="text-sm">
            {issue.message}
          </p>
        )}
        <button className="app-button w-full" disabled={busy}>
          {busy ? "Creating your account…" : "Create my owner account"}
        </button>
      </form>
      <button
        type="button"
        className="mt-4 min-h-11 w-full text-sm underline"
        disabled={busy}
        onClick={onSignIn}
      >
        Already set up? Sign in instead
      </button>
    </OwnerSetupFrame>
  );
}
