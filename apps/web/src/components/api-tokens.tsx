"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useId, useState } from "react";
import { ConfirmAction } from "./settings-confirm";
import {
  fieldControl,
  primaryControl,
  quietControl,
  settingsRow,
  textControl,
} from "./settings-controls";
import { SettingsSection } from "./settings-section";

function when(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Personal API tokens: other apps send articles in and read highlights back. */
export function ApiTokens() {
  const id = useId();
  const tokens = useQuery(api.apiTokens.list, {});
  const create = useAction(api.apiTokens.create);
  const revoke = useMutation(api.apiTokens.revoke);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; token: string }>();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);

  return (
    <SettingsSection
      title="Sending from other apps"
      description="A token lets another app add articles to your library and read your highlights on them. It can't read anything else or change your account."
    >
      {created && (
        <div className="rounded-md bg-[var(--reader-chip)] p-4">
          <p className="text-sm font-medium">
            Token for {created.name}. Copy it now: it isn't shown again.
          </p>
          <pre className="mt-2 whitespace-pre-wrap break-all text-sm select-all">
            {created.token}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={quietControl}
              onClick={() =>
                navigator.clipboard
                  .writeText(created.token)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError("Couldn't copy. Select the token instead."),
                  )
              }
            >
              {copied ? "Copied" : "Copy token"}
            </button>
            <button
              type="button"
              className={textControl}
              onClick={() => {
                setCreated(undefined);
                setCopied(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          setError("");
          try {
            const { token } = await create({ name });
            setCreated({ name: name.trim(), token });
            setCopied(false);
            setName("");
          } catch (err) {
            setError(
              err instanceof ConvexError && typeof err.data === "string"
                ? err.data
                : "Couldn't create a token. Try again.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor={id} className="mb-2 block text-sm">
          App name
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={id}
            autoComplete="off"
            maxLength={80}
            placeholder="For example, mail on my laptop"
            className={`${fieldControl} max-w-sm flex-1`}
            value={name}
            disabled={busy}
            aria-invalid={Boolean(error)}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            className={primaryControl}
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating…" : "Create token"}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      <div>
        {tokens?.map((token) => (
          <div key={token.id} className={settingsRow}>
            <div className="min-w-0 text-sm">
              <span className="font-medium">{token.name}</span>
              <p className="text-[13px] text-[var(--reader-muted)]">
                ending {token.last4} · created {when(token.createdAt)}
                {token.lastUsedAt
                  ? ` · last used ${when(token.lastUsedAt)}`
                  : " · not used yet"}
              </p>
            </div>
            <ConfirmAction
              label="Revoke"
              ariaLabel={`Revoke the token for ${token.name}`}
              question={`Revoke the token for ${token.name}? That app stops working with your library. Articles it added stay.`}
              confirmLabel="Revoke"
              open={revoking === token.id}
              onOpenChange={(open) => setRevoking(open ? token.id : null)}
              onConfirm={() =>
                void revoke({ tokenId: token.id }).catch(() =>
                  setError("Couldn't revoke that token. Try again."),
                )
              }
            />
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
