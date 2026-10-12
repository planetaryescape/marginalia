"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { Fingerprint, LockKeyhole } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useReaderSettings } from "@/lib/reader-settings";
import { useReaderTheme } from "@/lib/use-reader-theme";

export function AuthGate({ children }: { children: ReactNode }) {
  const { settings } = useReaderSettings();
  useReaderTheme(settings);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const owner = useQuery(api.auth.currentOwner, isAuthenticated ? {} : "skip");
  if (isLoading || (isAuthenticated && owner === undefined))
    return (
      <div className="auth-screen" role="status">
        Opening your reader…
      </div>
    );
  if (isAuthenticated && owner) return children;
  if (isAuthenticated)
    return (
      <div className="auth-screen">
        <p>This reader is private.</p>
        <button className="app-button" onClick={() => authClient.signOut()}>
          Sign out
        </button>
      </div>
    );
  return <SignIn />;
}

function SignIn() {
  const [setup, setSetup] = useState("");
  const [passwordForm, setPasswordForm] = useState(false);
  const [factor, setFactor] = useState(false);
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "setup",
    );
    if (token) {
      setSetup(token);
      setPasswordForm(true);
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      if (factor) {
        const code = String(fields.get("code") ?? "").trim();
        const result = backup
          ? await authClient.twoFactor.verifyBackupCode({ code })
          : await authClient.twoFactor.verifyTotp({ code });
        if (result.error)
          throw new Error(
            "That code wasn't accepted. Try a fresh code or a recovery code.",
          );
      } else {
        const email = String(fields.get("email") ?? "").trim();
        const password = String(fields.get("password") ?? "");
        const result = setup
          ? await authClient.signUp.email({
              email,
              password,
              name: "Reader owner",
              fetchOptions: { headers: { "x-reader-setup": setup } },
            })
          : await authClient.signIn.email({ email, password });
        if (result.error)
          throw new Error(
            setup
              ? "Couldn't claim the reader. Check your setup link and use a password of at least 12 characters."
              : "Couldn't sign in. Check your email and password, or try your passkey.",
          );
        if (
          result.data &&
          "twoFactorRedirect" in result.data &&
          result.data.twoFactorRedirect
        )
          setFactor(true);
        else setSetup("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen bg-[var(--reader-bg)] text-[var(--reader-fg)]">
      <div className="w-full max-w-sm">
        <p className="font-serif text-2xl mb-10">Marginalia</p>
        <LockKeyhole size={24} className="mb-4 text-[var(--reader-muted)]" />
        <h1 className="font-serif text-3xl mb-3">
          {setup
            ? "Make this reader yours"
            : factor
              ? "One more check"
              : "Your reading desk"}
        </h1>
        <p className="text-sm text-[var(--reader-muted)] mb-7">
          {setup
            ? "Choose your fallback password. Add a passkey after signing in for quicker access next time."
            : factor
              ? "Enter your authenticator code, or use a saved recovery code."
              : "Sign in to return to your articles and notes."}
        </p>
        {!passwordForm && !factor && (
          <button
            disabled={busy}
            className="app-button w-full mb-4"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await authClient.signIn.passkey();
                if (result.error)
                  setError(
                    "Passkey sign-in didn't complete. Try again or use your password.",
                  );
              } catch {
                setError(
                  "Passkeys aren't available here. Use your password instead.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Fingerprint size={20} />
            {busy ? "Signing in…" : "Continue with a passkey"}
          </button>
        )}
        {(passwordForm || factor) && (
          <form onSubmit={submit} className="space-y-4">
            {factor ? (
              <label className="block text-sm">
                {backup ? "Recovery code" : "Authenticator code"}
                <input
                  className="app-input mt-2"
                  name="code"
                  autoComplete="one-time-code"
                  inputMode={backup ? "text" : "numeric"}
                  required
                />
              </label>
            ) : (
              <>
                <label className="block text-sm">
                  Email
                  <input
                    className="app-input mt-2"
                    name="email"
                    type="email"
                    autoComplete="username webauthn"
                    required
                  />
                </label>
                <label className="block text-sm">
                  Password
                  <input
                    className="app-input mt-2"
                    name="password"
                    type="password"
                    autoComplete={setup ? "new-password" : "current-password"}
                    minLength={setup ? 12 : undefined}
                    required
                  />
                </label>
              </>
            )}
            <button className="app-button w-full" disabled={busy}>
              {busy
                ? "Please wait…"
                : setup
                  ? "Claim my reader"
                  : factor
                    ? "Verify and sign in"
                    : "Sign in"}
            </button>
          </form>
        )}
        {!setup && (
          <button
            className="min-h-11 w-full text-sm text-[var(--reader-muted)] mt-2"
            onClick={() => {
              if (factor) setBackup(!backup);
              else setPasswordForm(!passwordForm);
              setError("");
            }}
          >
            {factor
              ? backup
                ? "Use an authenticator code"
                : "Use a recovery code"
              : passwordForm
                ? "Use a passkey instead"
                : "Use email and password"}
          </button>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-[var(--reader-fg)]">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
