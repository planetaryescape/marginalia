"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

/** Readwise Reader connection: status, last sync and a manual sync. */
export function ReadwiseCard() {
  const status = useQuery(api.readwise.status, {});
  const syncNow = useAction(api.readwise.syncNow);
  const [syncing, setSyncing] = useState(false);

  if (!status) return null;

  return (
    <section className="mb-10 rounded-xl border border-[var(--reader-border)] bg-[var(--reader-surface)] p-4 font-sans">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "w-2 h-2 rounded-full",
            !status.connected
              ? "bg-[var(--reader-muted)]"
              : status.error
                ? "bg-annotation-tension"
                : "bg-annotation-context",
          )}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--reader-fg)]">
            Readwise Reader
          </p>
          <p className="text-xs text-[var(--reader-muted)]">
            {!status.connected
              ? "Not connected"
              : status.error
                ? `Last sync failed ${status.checkedAt ? ago(status.checkedAt) : ""}`
                : status.progress?.active
                  ? `${status.progress.backfilling ? "Importing full library" : "Syncing updates"} · ${status.progress.phase}`
                  : status.syncedAt
                    ? `Synced ${ago(status.syncedAt)} · Inbox, Later and Shortlist`
                    : "Connected · first sync pending"}
          </p>
        </div>
        {status.connected && (
          <button
            type="button"
            disabled={syncing}
            onClick={async () => {
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
            }}
            className="shrink-0 flex items-center gap-1.5 text-sm text-[var(--ink-soft)] hover:text-[var(--ink)] hover:underline disabled:opacity-40"
          >
            <RefreshCw
              size={13}
              className={syncing ? "animate-spin" : undefined}
            />
            Sync now
          </button>
        )}
      </div>
      {status.connected && status.progress && (
        <p
          className="mt-2 text-xs leading-relaxed text-[var(--reader-muted)]"
          role="status"
        >
          {status.progress.scanned} documents checked ·{" "}
          {status.progress.imported} newly imported · {status.progress.skipped}{" "}
          skipped (unsupported, missing text or too large).
          {status.progress.backfilling &&
            " Older items are imported in small batches; you can close the app."}
          {status.progress.active &&
            status.error &&
            " Progress is saved; Sync now retries the current page."}
          {status.pendingAnnotations !== null &&
            ` ${status.pendingAnnotations} articles awaiting annotation across your library.`}
        </p>
      )}
      {status.connected && status.error && (
        <p className="mt-2 text-xs text-annotation-tension break-words">
          {status.error}
        </p>
      )}
      {status.source === "saved" && status.last4 && (
        <DisconnectReadwise last4={status.last4} />
      )}
      {status.source !== "saved" && (
        <ConnectReadwise deployment={status.source === "deployment"} />
      )}
    </section>
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
      className="mt-3"
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
        className="block text-xs leading-relaxed text-[var(--reader-muted)]"
      >
        {deployment
          ? "Using the reader's built-in Readwise token. Connect your own to replace it. "
          : "Connect Readwise to import your Inbox, Later and Shortlist. Finishing an article archives it in Reader, and highlights sync both ways. "}
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
          className="app-input max-w-sm flex-1"
          value={token}
          disabled={busy}
          aria-invalid={Boolean(error)}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          type="submit"
          className="app-button secondary"
          disabled={busy || !token.trim()}
        >
          {busy ? "Checking…" : "Connect"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-annotation-tension">
          {error}
        </p>
      )}
    </form>
  );
}

function DisconnectReadwise({ last4 }: { last4: string }) {
  const disconnect = useMutation(api.readwise.disconnect);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--reader-muted)]">
      <span>Your token, ending {last4}</span>
      <button
        type="button"
        className="min-h-11 px-3 text-sm text-[var(--reader-fg)]"
        disabled={busy}
        onClick={() => {
          if (
            !confirm(
              "Disconnect Readwise? Articles already imported stay in your library.",
            )
          )
            return;
          setBusy(true);
          disconnect({})
            .catch(() => toast.error("Couldn't disconnect Readwise"))
            .finally(() => setBusy(false));
        }}
      >
        Disconnect
      </button>
    </div>
  );
}
