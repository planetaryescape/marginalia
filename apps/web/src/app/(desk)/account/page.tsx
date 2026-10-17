"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import QRCode from "react-qr-code";
import { AiProviders } from "@/components/ai-providers";
import { InlineError } from "@/components/in-place";
import { FeedbackPreferences } from "@/components/interaction-feedback";
import { ConfirmAction } from "@/components/settings-confirm";
import {
  confirmControl,
  fieldControl,
  primaryControl,
  quietControl,
  settingsRow,
} from "@/components/settings-controls";
import { SettingsPage, SettingsSection } from "@/components/settings-section";
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
  // A failed action stays on the page with Retry, which runs the same action again
  const [failure, setFailure] = useState<{
    text: string;
    task: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [codesSaved, setCodesSaved] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    setFailure(null);
    try {
      await task();
    } catch (e) {
      setFailure({
        text:
          e instanceof Error
            ? e.message
            : "Couldn't complete that action. Try again.",
        task,
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsPage
      title="Your account"
      meta={
        <>
          {reader?.email ?? session?.user.email}
          {reader?.isOwner && " · Owner"}
        </>
      }
    >
      <SettingsSection
        title="Signing in"
        description="Passkeys are the everyday way in. Authenticator codes and a password are fallbacks."
      >
        <div className="space-y-8">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Passkeys</h3>
            <p className="text-sm text-[var(--reader-muted)]">
              Use Face ID, Touch ID, a security key or your password manager.
              You stay signed in between visits.
            </p>
            <button
              type="button"
              className={primaryControl}
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
            <div>
              {passkeys?.map((key) => (
                <div key={key.id} className={settingsRow}>
                  <span className="text-sm">
                    {key.name || "Reader passkey"}
                  </span>
                  <ConfirmAction
                    label="Remove"
                    ariaLabel={`Remove passkey ${key.name || "Reader passkey"}`}
                    question="Remove this passkey? You can still use your password."
                    confirmLabel="Remove"
                    busy={busy}
                    open={confirming === `passkey:${key.id}`}
                    onOpenChange={(open) =>
                      setConfirming(open ? `passkey:${key.id}` : null)
                    }
                    onConfirm={() =>
                      void run(async () => {
                        const result = await authClient.passkey.deletePasskey({
                          id: key.id,
                        });
                        if (result.error)
                          throw new Error("Couldn't remove this passkey.");
                        await refetch();
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Authenticator codes</h3>
            <p className="text-sm text-[var(--reader-muted)]">
              Optional extra protection when signing in with your password.
              Passkeys already verify you on your device and don't need a second
              code.
            </p>
            <label className="block text-sm">
              Current password
              <input
                type="password"
                autoComplete="current-password"
                className={`${fieldControl} mt-2 max-w-sm`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {totp ? (
              <div className="space-y-4">
                {/* Scanners need a light quiet zone, so the QR stays white in dark themes */}
                <div className="w-fit rounded-lg bg-[#fff] p-4">
                  <QRCode value={totp.totpURI} size={180} />
                </div>
                <p className="text-sm">
                  Scan this QR code in your authenticator, then verify a code.
                </p>
                <label className="block text-sm">
                  Authenticator code
                  <input
                    className={`${fieldControl} mt-2 max-w-sm`}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className={primaryControl}
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
                <label className="flex min-h-11 items-center gap-3 text-sm">
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
                  type="button"
                  className={quietControl}
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
                type="button"
                className={quietControl}
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
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Fallback password</h3>
            <p className="text-sm text-[var(--reader-muted)]">
              Use the current password field above to confirm this change.
            </p>
            <label className="block text-sm">
              New password
              <input
                className={`${fieldControl} mt-2 max-w-sm`}
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={quietControl}
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
          </div>

          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          {failure && (
            <InlineError
              message={failure.text}
              busy={busy}
              onRetry={() => void run(failure.task)}
            />
          )}
          <div>
            <button
              type="button"
              className={quietControl}
              onClick={() => authClient.signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
      </SettingsSection>

      <AiProviders />
      <FeedbackPreferences />

      {reader && !reader.isOwner && <DeleteAccount />}
      <SourceLink className="mt-16" />
    </SettingsPage>
  );
}

const CONFIRM = "DELETE";

function DeleteAccount() {
  const deleteMine = useMutation(api.account.deleteMine);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
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
  };
  return (
    <SettingsSection
      title="Delete my account"
      className="mt-16"
      description="Removes your library, notes, highlights, saved keys, app tokens and Readwise connection, then your sign-in. This can't be undone."
    >
      <label className="block text-sm">
        Type {CONFIRM} to confirm
        <input
          className={`${fieldControl} mt-2 max-w-sm`}
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <div>
        <button
          type="button"
          className={confirmControl}
          disabled={busy || typed !== CONFIRM}
          onClick={remove}
        >
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
      {error && <InlineError message={error} busy={busy} onRetry={remove} />}
    </SettingsSection>
  );
}
