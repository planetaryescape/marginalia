"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Fingerprint, LogOut, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import QRCode from "react-qr-code";
import { AiProviders } from "@/components/ai-providers";
import { ApiTokens } from "@/components/api-tokens";
import { DeskPage } from "@/components/desk-page";
import { FeedbackPreferences } from "@/components/interaction-feedback";
import { SourceLink } from "@/components/source-link";
import { authClient } from "@/lib/auth-client";

export default function AccountPage() {
  const { data: session } = authClient.useSession();
  const reader = useQuery(api.auth.currentReader, {});
  const { data: passkeys, refetch } = authClient.useListPasskeys();
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState<{
    totpURI: string;
    backupCodes: string[];
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [codesSaved, setCodesSaved] = useState(false);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Couldn't complete that action. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <DeskPage title="Your account">
      <p className="text-sm text-[var(--reader-muted)] mb-8">
        {reader?.email ?? session?.user.email}
        {reader?.isOwner && " · Owner"}
      </p>
      {reader?.isOwner && (
        <Link
          href="/readers"
          data-reader-transition
          className="app-button secondary mb-8"
        >
          <Users size={18} />
          Manage readers and requests
        </Link>
      )}
      <section className="account-section">
        <h2 className="flex items-center gap-2 font-serif text-2xl">
          <Fingerprint size={22} />
          Passkeys
        </h2>
        <p className="text-sm text-[var(--reader-muted)] my-3">
          Use Face ID, Touch ID, a security key or your password manager. You
          stay signed in between visits.
        </p>
        <button
          className="app-button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await authClient.passkey.addPasskey({
                name: "My reader passkey",
              });
              if (result.error)
                throw new Error(
                  result.error.message ?? "Passkey setup didn't complete.",
                );
              await refetch();
              setMessage(
                "Passkey added. Next time, choose Continue with a passkey.",
              );
            })
          }
        >
          Add a passkey
        </button>
        {passkeys?.map((key) => (
          <div
            key={key.id}
            className="flex items-center justify-between gap-4 py-3 border-b border-[var(--reader-border)]"
          >
            <span className="text-sm">{key.name || "Reader passkey"}</span>
            <button
              className="min-h-11 px-3 text-sm"
              disabled={busy}
              onClick={() => {
                if (
                  !confirm(
                    "Remove this passkey? You can still use your password.",
                  )
                )
                  return;
                void run(async () => {
                  const result = await authClient.passkey.deletePasskey({
                    id: key.id,
                  });
                  if (result.error)
                    throw new Error("Couldn't remove this passkey.");
                  await refetch();
                });
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </section>
      <section className="account-section">
        <h2 className="flex items-center gap-2 font-serif text-2xl">
          <ShieldCheck size={22} />
          Authenticator codes
        </h2>
        <p className="text-sm text-[var(--reader-muted)] my-3">
          Optional extra protection when signing in with your password. Passkeys
          already verify you on your device and don't need a second code.
        </p>
        <label className="block text-sm mb-4">
          Current password
          <input
            type="password"
            autoComplete="current-password"
            className="app-input mt-2 max-w-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {totp ? (
          <div className="space-y-4">
            <div className="w-fit bg-white p-4 rounded-lg">
              <QRCode value={totp.totpURI} size={180} />
            </div>
            <p className="text-sm">
              Scan this QR code in your authenticator, then verify a code.
            </p>
            <label className="block text-sm">
              Authenticator code
              <input
                className="app-input mt-2 max-w-sm"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button
              className="app-button"
              disabled={busy || !code || verified || !codesSaved}
              onClick={() =>
                run(async () => {
                  const result = await authClient.twoFactor.verifyTotp({
                    code,
                  });
                  if (result.error)
                    throw new Error(
                      "That code wasn't accepted. Try the next code.",
                    );
                  setMessage(
                    "Authenticator enabled. Save your recovery codes before closing this panel.",
                  );
                  setPassword("");
                  setVerified(true);
                })
              }
            >
              {verified ? "Authenticator verified" : "Verify authenticator"}
            </button>
            <p className="text-sm font-medium">
              Save these recovery codes in your password manager. Each works
              once.
            </p>
            <pre className="text-sm leading-7 whitespace-pre-wrap select-all">
              {totp.backupCodes.join("\n")}
            </pre>
            <label className="flex items-center gap-3 min-h-11 text-sm">
              <input
                type="checkbox"
                checked={codesSaved}
                onChange={(e) => setCodesSaved(e.target.checked)}
              />
              I've saved my recovery codes
            </label>
            <p className="text-xs text-[var(--reader-muted)]">
              Save the codes before verifying. Verification may refresh your
              session and close this setup panel.
            </p>
            <button
              className="app-button secondary"
              disabled={!verified}
              onClick={() => {
                setTotp(null);
                setCode("");
                setVerified(false);
                setCodesSaved(false);
              }}
            >
              I've saved my codes
            </button>
          </div>
        ) : (
          <button
            className="app-button secondary"
            disabled={busy || !password}
            onClick={() =>
              run(async () => {
                if (session?.user.twoFactorEnabled) {
                  const result = await authClient.twoFactor.disable({
                    password,
                  });
                  if (result.error)
                    throw new Error(
                      "Couldn't disable codes. Check your password.",
                    );
                  setMessage("Authenticator codes disabled.");
                } else {
                  const result = await authClient.twoFactor.enable({
                    password,
                  });
                  if (result.error || !result.data)
                    throw new Error(
                      "Couldn't start authenticator setup. Check your password.",
                    );
                  setTotp(result.data);
                  setVerified(false);
                  setCodesSaved(false);
                }
              })
            }
          >
            {session?.user.twoFactorEnabled
              ? "Disable authenticator codes"
              : "Set up authenticator codes"}
          </button>
        )}
      </section>
      <section className="account-section">
        <h2 className="font-serif text-2xl mb-3">Fallback password</h2>
        <p className="text-sm text-[var(--reader-muted)] mb-4">
          Use the current password field above to confirm this change.
        </p>
        <label className="block text-sm">
          New password
          <input
            className="app-input mt-2 max-w-sm"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <button
          className="app-button secondary mt-4"
          disabled={busy || !password || newPassword.length < 12}
          onClick={() =>
            run(async () => {
              const result = await authClient.changePassword({
                currentPassword: password,
                newPassword,
                revokeOtherSessions: true,
              });
              if (result.error)
                throw new Error("Couldn't change your password.");
              setPassword("");
              setNewPassword("");
              setMessage(
                "Password changed. Other sessions have been signed out.",
              );
            })
          }
        >
          Change password
        </button>
      </section>
      {message && (
        <p role="status" className="text-sm my-4">
          {message}
        </p>
      )}
      <AiProviders />
      <ApiTokens />
      <FeedbackPreferences />
      <button
        className="app-button secondary mb-8"
        onClick={() => authClient.signOut()}
      >
        <LogOut size={18} />
        Sign out
      </button>
      {reader && !reader.isOwner && <DeleteAccount />}
      <SourceLink variant="text" className="mb-8" />
    </DeskPage>
  );
}

const CONFIRM = "DELETE";

function DeleteAccount() {
  const deleteMine = useMutation(api.account.deleteMine);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="account-section mb-8">
      <h2 className="font-serif text-2xl mb-3">Delete my account</h2>
      <p className="text-sm text-[var(--reader-muted)] mb-4">
        Removes your library, notes, highlights, saved keys, app tokens and
        Readwise connection, then your sign-in. This can't be undone.
      </p>
      <label className="block text-sm">
        Type {CONFIRM} to confirm
        <input
          className="app-input mt-2 max-w-sm"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <button
        className="app-button secondary mt-4"
        disabled={busy || typed !== CONFIRM}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await deleteMine({ confirmation: typed });
            await authClient.signOut().catch(() => {});
          } catch (e) {
            setError(
              e instanceof ConvexError && typeof e.data === "string"
                ? e.data
                : "Couldn't delete your account. Try again.",
            );
            setBusy(false);
          }
        }}
      >
        {busy ? "Deleting…" : "Delete my account"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-annotation-tension">
          {error}
        </p>
      )}
    </section>
  );
}
