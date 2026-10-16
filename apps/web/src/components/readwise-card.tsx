"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "./settings-confirm";
import {
  fieldControl,
  primaryControl,
  quietControl,
} from "./settings-controls";
import { SettingsSection, type SettingsStatus } from "./settings-section";

export function ago(timestamp: number) {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** Readwise Reader connection: status at the right, a sync control, Details for the counts. */
export function ReadwiseCard() {
  const status = useQuery(api.readwise.status, {});
  const syncNow = useAction(api.readwise.syncNow);
  const disconnect = useMutation(api.readwise.disconnect);
  const [syncing, setSyncing] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  if (!status) return null;

  const sectionStatus: SettingsStatus = !status.connected
    ? { tone: "quiet", label: "Not connected" }
    : status.error
      ? {
          tone: "failed",
          label:
            `Last sync failed ${status.checkedAt ? ago(status.checkedAt) : ""}`.trim(),
        }
      : status.progress?.active
        ? {
            tone: "progress",
            label: `${status.progress.backfilling ? "Importing full library" : "Syncing updates"} · ${status.progress.phase}`,
          }
        : status.syncedAt
          ? { tone: "quiet", label: `Synced ${ago(status.syncedAt)}` }
          : { tone: "quiet", label: "Connected · first sync pending" };

  const sync = async () => {
    setSyncing(true);
    try {
      await syncNow({});
      toast.success(
        "Syncing from Reader… new articles appear as they're imported.",
      );
    } catch {
      toast.error("Couldn't start the sync");
    }
    setSyncing(false);
  };

  return (
    <SettingsSection
      title="Readwise Reader"
      status={sectionStatus}
      description={
        !status.connected
          ? "Connect Readwise to import your Inbox, Later and Shortlist. Finishing an article archives it in Reader, and highlights sync both ways."
          : status.error
            ? status.error
            : "Imports your Inbox, Later and Shortlist. Finishing an article archives it in Reader."
      }
      details={
        status.connected && status.progress ? (
          <p role="status">
            {status.progress.scanned} documents checked ·{" "}
            {status.progress.imported} newly imported ·{" "}
            {status.progress.skipped} skipped (unsupported, missing text or too
            large).
            {status.progress.backfilling &&
              " Older items are imported in small batches; you can close the app."}
            {status.progress.active &&
              status.error &&
              " Progress is saved; Sync now retries the current page."}
            {status.pendingAnnotations !== null &&
              ` ${status.pendingAnnotations} articles awaiting annotation across your library.`}
          </p>
        ) : undefined
      }
    >
      {status.connected && (
        <div className="flex flex-wrap items-center gap-2">
          {status.error ? (
            <button
              type="button"
              disabled={syncing}
              onClick={sync}
              className={primaryControl}
            >
              Try again
            </button>
          ) : (
            <button
              type="button"
              disabled={syncing}
              onClick={sync}
              className={quietControl}
            >
              <RefreshCw
                size={13}
                aria-hidden
                className={syncing ? "motion-safe:animate-spin" : undefined}
              />
              Sync now
            </button>
          )}
        </div>
      )}
      {status.source === "saved" && status.last4 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-[var(--reader-muted)]">
          <span>Your token, ending {status.last4}</span>
          <ConfirmAction
            label="Disconnect"
            question="Disconnect Readwise? Articles already imported stay in your library."
            confirmLabel="Disconnect"
            open={confirmingDisconnect}
            onOpenChange={setConfirmingDisconnect}
            onConfirm={() =>
              void disconnect({}).catch(() =>
                toast.error("Couldn't disconnect Readwise"),
              )
            }
          />
        </div>
      )}
      {status.source !== "saved" && (
        <ConnectReadwise deployment={status.source === "deployment"} />
      )}
    </SettingsSection>
  );
}

function ConnectReadwise({ deployment }: { deployment: boolean }) {
  const id = useId();
  const connect = useAction(api.readwise.connect);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!token.trim()) return;
        setBusy(true);
        setError("");
        try {
          await connect({ token });
          toast.success("Readwise connected. Your first sync is starting.");
        } catch (err) {
          setError(
            err instanceof ConvexError && typeof err.data === "string"
              ? err.data
              : "Couldn't connect Readwise. Try again.",
          );
        } finally {
          // The token never stays in the page once it has been sent
          setToken("");
          setBusy(false);
        }
      }}
    >
      <label
        htmlFor={id}
        className="block text-[13px] leading-relaxed text-[var(--reader-muted)]"
      >
        {deployment
          ? "Using the reader's built-in Readwise token. Connect your own to replace it. "
          : ""}
        Get your token at{" "}
        <a
          className="underline"
          href="https://readwise.io/access_token"
          target="_blank"
          rel="noreferrer"
        >
          readwise.io/access_token
        </a>
        .
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Readwise access token"
          className={`${fieldControl} max-w-sm flex-1`}
          value={token}
          disabled={busy}
          aria-invalid={Boolean(error)}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          type="submit"
          className={primaryControl}
          disabled={busy || !token.trim()}
        >
          {busy ? "Checking…" : "Connect"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </form>
  );
}
