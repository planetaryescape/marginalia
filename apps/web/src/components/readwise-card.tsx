"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function ago(timestamp: number) {
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
            className="shrink-0 flex items-center gap-1.5 text-sm text-[var(--pen)] hover:underline disabled:opacity-40"
          >
            <RefreshCw
              size={13}
              className={syncing ? "animate-spin" : undefined}
            />
            Sync now
          </button>
        )}
      </div>
      {status.connected && status.error && (
        <p className="mt-2 text-xs text-annotation-tension break-words">
          {status.error}
        </p>
      )}
      {!status.connected && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--reader-muted)]">
          Set <code className="font-mono">READWISE_TOKEN</code> in Convex to
          import your Inbox, Later and Shortlist. Finishing an article archives
          it in Reader, and highlights sync both ways.
        </p>
      )}
    </section>
  );
}
