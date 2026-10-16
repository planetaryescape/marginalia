"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Fingerprint, LockKeyhole } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SourceLink } from "@/components/source-link";
import { authClient } from "@/lib/auth-client";
import { useReaderSettings } from "@/lib/reader-settings";
import { useReaderTheme } from "@/lib/use-reader-theme";

export const ALREADY_SIGNED_IN =
  "You're already signed in. Sign out to use an invite link.";

export interface FragmentTokens {
  invite: string;
  setup: string;
}

/**
 * Takes the one-time #invite= and #setup= tokens from the URL and removes
 * the fragment, keeping the path and query, so they never linger in history.
 */
export function takeFragmentTokens(
  win: Pick<Window, "location" | "history">,
): FragmentTokens {
  const params = new URLSearchParams(win.location.hash.slice(1));
  if (params.has("invite") || params.has("setup"))
    win.history.replaceState(
      null,
      "",
      win.location.pathname + win.location.search,
    );
  return {
    invite: params.get("invite") ?? "",
    setup: params.get("setup") ?? "",
  };
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { settings } = useReaderSettings();
  useReaderTheme(settings);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const reader = useQuery(
    api.auth.currentReader,
    isAuthenticated ? {} : "skip",
  );
  // Stripped on every load, signed in or not; only sign-up uses them
  const [fragment, setFragment] = useState<FragmentTokens | null>(null);
  useEffect(() => setFragment(takeFragmentTokens(window)), []);
  const checked = useRef(false);
  useEffect(() => {
    if (!fragment || isLoading) return;
    // An invite opened while signed in is never sent anywhere
    if (!checked.current && isAuthenticated && fragment.invite)
      toast(ALREADY_SIGNED_IN);
    checked.current = true;
    if (isAuthenticated) setFragment(null);
  }, [fragment, isLoading, isAuthenticated]);
  if (isLoading || (isAuthenticated && reader === undefined))
    return (
      <div className="auth-screen" role="status">
        Opening your reader…
      </div>
    );
  if (isAuthenticated && reader) return children;
  if (isAuthenticated)
    return (
      <main className="auth-screen">
        <div className="w-full max-w-sm">
          <p className="font-serif text-2xl mb-10">Marginalia</p>
          <h1 className="font-serif text-3xl mb-3">No access right now</h1>
          <p className="text-sm text-[var(--reader-muted)] mb-7">
            This account can't open the reader. It may have been disabled, or it
            was never approved. Sign out to use a different account.
          </p>
          <button
            className="app-button w-full"
            onClick={() => authClient.signOut()}
          >
            Sign out
          </button>
        </div>
      </main>
    );
  return <SignIn fragment={fragment} />;
}

function SignIn({ fragment }: { fragment: FragmentTokens | null }) {
  const [setup, setSetup] = useState("");
  const [invite, setInvite] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [passwordForm, setPasswordForm] = useState(false);
  const [factor, setFactor] = useState(false);
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!fragment) return;
    const invited = fragment.invite;
    const owner = invited ? "" : fragment.setup;
    if (invited) setInvite(invited);
    if (owner) setSetup(owner);
    if (invited || owner) setPasswordForm(true);
  }, [fragment]);
  const signingUp = Boolean(setup || invite);
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
        const name = String(fields.get("name") ?? "").trim();
        const result = signingUp
          ? await authClient.signUp.email({
              email,
              password,
              name: invite ? name || email : "Reader owner",
              fetchOptions: {
                headers: invite
                  ? { "x-reader-invite": invite }
                  : { "x-reader-setup": setup },
              },
            })
          : await authClient.signIn.email({ email, password });
        if (result.error)
          throw new Error(
            invite
              ? "Couldn't create your account. Use the email your invite was sent for, a password of at least 12 characters, and a link that hasn't expired."
              : setup
                ? "Couldn't claim the reader. Check your setup link and use a password of at least 12 characters."
                : "Couldn't sign in. Check your email and password, or try your passkey.",
          );
        if (
          result.data &&
          "twoFactorRedirect" in result.data &&
          result.data.twoFactorRedirect
        )
          setFactor(true);
        else {
          setSetup("");
          setInvite("");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }
  if (requesting && !signingUp)
    return <RequestAccess onBack={() => setRequesting(false)} />;
  return (
    <main className="auth-screen bg-[var(--reader-bg)] text-[var(--reader-fg)]">
      <div className="w-full max-w-sm">
        <p className="font-serif text-2xl mb-10">Marginalia</p>
        <LockKeyhole size={24} className="mb-4 text-[var(--reader-muted)]" />
        <h1 className="font-serif text-3xl mb-3">
          {invite
            ? "Set up your reader"
            : setup
              ? "Make this reader yours"
              : factor
                ? "One more check"
                : "Your reading desk"}
        </h1>
        <p className="text-sm text-[var(--reader-muted)] mb-7">
          {signingUp
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
                {invite && (
                  <label className="block text-sm">
                    Your name
                    <input
                      className="app-input mt-2"
                      name="name"
                      autoComplete="name"
                      maxLength={100}
                      required
                    />
                  </label>
                )}
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
                    autoComplete={
                      signingUp ? "new-password" : "current-password"
                    }
                    minLength={signingUp ? 12 : undefined}
                    required
                  />
                </label>
              </>
            )}
            <button className="app-button w-full" disabled={busy}>
              {busy
                ? "Please wait…"
                : invite
                  ? "Create my account"
                  : setup
                    ? "Claim my reader"
                    : factor
                      ? "Verify and sign in"
                      : "Sign in"}
            </button>
          </form>
        )}
        {!signingUp && (
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
        {!signingUp && !factor && (
          <button
            className="min-h-11 w-full text-sm text-[var(--reader-muted)]"
            onClick={() => {
              setRequesting(true);
              setError("");
            }}
          >
            Request access
          </button>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-[var(--reader-fg)]">
            {error}
          </p>
        )}
      </div>
      <SourceLink className="mt-10" />
    </main>
  );
}

export function RequestAccess({ onBack }: { onBack: () => void }) {
  const request = useMutation(api.waitlist.request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const result = await request({
        email: String(fields.get("email") ?? ""),
        name: String(fields.get("name") ?? ""),
        note: String(fields.get("note") ?? "") || undefined,
      });
      setDone(result.message);
    } catch (e) {
      setError(
        e instanceof ConvexError && typeof e.data === "string"
          ? e.data
          : "Couldn't send your request. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen bg-[var(--reader-bg)] text-[var(--reader-fg)]">
      <div className="w-full max-w-sm">
        <p className="font-serif text-2xl mb-10">Marginalia</p>
        <h1 className="font-serif text-3xl mb-3">Request access</h1>
        {done ? (
          <p role="status" className="text-sm mb-7">
            {done}
          </p>
        ) : (
          <>
            <p className="text-sm text-[var(--reader-muted)] mb-7">
              Marginalia is a small, invite-only reader. Leave your details and
              the owner may send you an invite.
            </p>
            <form onSubmit={submit} className="space-y-4">
              <label className="block text-sm">
                Email
                <input
                  className="app-input mt-2"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>
              <label className="block text-sm">
                Name
                <input
                  className="app-input mt-2"
                  name="name"
                  autoComplete="name"
                  maxLength={100}
                  required
                />
              </label>
              <label className="block text-sm">
                What you'd like to read with it{" "}
                <span className="text-[var(--reader-muted)]">(optional)</span>
                <textarea
                  className="app-input mt-2"
                  name="note"
                  rows={3}
                  maxLength={500}
                />
              </label>
              <button className="app-button w-full" disabled={busy}>
                {busy ? "Sending…" : "Request access"}
              </button>
            </form>
          </>
        )}
        <button
          className="min-h-11 w-full text-sm text-[var(--reader-muted)] mt-2"
          onClick={onBack}
        >
          Back to sign in
        </button>
        {error && (
          <p role="alert" className="mt-4 text-sm text-[var(--reader-fg)]">
            {error}
          </p>
        )}
      </div>
      <SourceLink className="mt-10" />
    </main>
  );
}
