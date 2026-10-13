"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Plug } from "lucide-react";
import { useId, useState } from "react";

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

  return (
    <section className="account-section">
      <h2 className="flex items-center gap-2 font-serif text-2xl">
        <Plug size={22} />
        Connected apps
      </h2>
      <p className="text-sm text-[var(--reader-muted)] my-3">
        A token lets another app add articles to your library and read your
        highlights on them. It can't read anything else or change your account.
      </p>
      {created && (
        <div className="my-4 rounded-lg border border-[var(--reader-border)] p-4">
          <p className="text-sm font-medium">
            Token for {created.name}. Copy it now: it isn't shown again.
          </p>
          <pre className="mt-2 text-sm whitespace-pre-wrap break-all select-all">
            {created.token}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="app-button secondary"
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
              className="min-h-11 px-3 text-sm"
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
        className="mt-2"
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
        <label htmlFor={id} className="block text-sm">
          App name
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id={id}
            autoComplete="off"
            maxLength={80}
            placeholder="For example, mail on my laptop"
            className="app-input max-w-sm flex-1"
            value={name}
            disabled={busy}
            aria-invalid={Boolean(error)}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            className="app-button secondary"
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating…" : "Create token"}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-annotation-tension">
          {error}
        </p>
      )}
      {tokens?.map((token) => (
        <div
          key={token.id}
          className="flex items-center justify-between gap-4 py-3 border-b border-[var(--reader-border)]"
        >
          <div className="text-sm min-w-0">
            <span className="font-medium">{token.name}</span>
            <span className="text-[var(--reader-muted)]">
              {" "}
              · ending {token.last4} · created {when(token.createdAt)}
              {token.lastUsedAt
                ? ` · last used ${when(token.lastUsedAt)}`
                : " · not used yet"}
            </span>
          </div>
          <button
            type="button"
            className="min-h-11 px-3 text-sm"
            aria-label={`Revoke the token for ${token.name}`}
            onClick={() => {
              if (
                !confirm(
                  `Revoke the token for ${token.name}? That app stops working with your library. Articles it added stay.`,
                )
              )
                return;
              revoke({ tokenId: token.id }).catch(() =>
                setError("Couldn't revoke that token. Try again."),
              );
            }}
          >
            Revoke
          </button>
        </div>
      ))}
    </section>
  );
}
