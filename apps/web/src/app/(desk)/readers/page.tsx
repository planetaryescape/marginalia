"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { DeskPage } from "@/components/desk-page";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : fallback;
}

function day(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const row =
  "flex flex-wrap items-center justify-between gap-3 py-3 border-b border-[var(--reader-border)]";

export default function ReadersPage() {
  const me = useQuery(api.auth.currentReader, {});
  const isOwner = me?.isOwner === true;
  const requests = useQuery(api.waitlist.listRequests, isOwner ? {} : "skip");
  const invites = useQuery(api.waitlist.listInvites, isOwner ? {} : "skip");
  const readers = useQuery(api.readers.list, isOwner ? {} : "skip");
  const approve = useAction(api.waitlist.approve);
  const decline = useMutation(api.waitlist.decline);
  const revoke = useMutation(api.waitlist.revokeInvite);
  const setStatus = useMutation(api.readers.setStatus);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(task: () => Promise<void>, fallback: string) {
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (e) {
      setMessage(errorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  if (me === undefined) return <DeskPage title="Readers">{null}</DeskPage>;
  if (!isOwner)
    return (
      <DeskPage title="Readers">
        <p className="text-sm text-[var(--reader-muted)]">
          Only the reader's owner can manage access.
        </p>
      </DeskPage>
    );

  return (
    <DeskPage title="Readers">
      <p className="text-sm text-[var(--reader-muted)] mb-8">
        Approve requests to create a one-time invite link, valid for 7 days.
        Send it to the person yourself; it's shown only once.
      </p>
      {link && (
        <section
          className="mb-8 rounded-xl border border-[var(--reader-border)] bg-[var(--reader-surface)] p-4"
          aria-live="polite"
        >
          <p className="text-sm font-medium mb-2">
            Invite link for {link.email}
          </p>
          <p className="text-xs text-[var(--reader-muted)] mb-3">
            Copy it now. It won't be shown again; revoke and re-approve if it's
            lost.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              readOnly
              className="app-input flex-1 min-w-0 font-mono text-xs"
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Invite link"
            />
            <button
              type="button"
              className="app-button secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(link.url);
                setCopied(true);
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="min-h-11 px-3 text-sm"
              onClick={() => {
                setLink(null);
                setCopied(false);
              }}
            >
              Done
            </button>
          </div>
        </section>
      )}
      {message && (
        <p role="alert" className="text-sm mb-6">
          {message}
        </p>
      )}

      <section className="account-section">
        <h2 className="font-serif text-2xl mb-3">Requests</h2>
        {requests?.pending.length === 0 && (
          <p className="text-sm text-[var(--reader-muted)]">
            No one is waiting.
          </p>
        )}
        {requests?.pending.map((request) => (
          <div key={request._id} className={row}>
            <div className="min-w-0 text-sm">
              <p className="font-medium break-words">
                {request.name}{" "}
                <span className="text-[var(--reader-muted)] font-normal">
                  · {request.email}
                </span>
              </p>
              {request.note && (
                <p className="text-[var(--reader-muted)] break-words mt-1">
                  {request.note}
                </p>
              )}
              <p className="text-xs text-[var(--reader-muted)] mt-1">
                Asked {day(request.createdAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="app-button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await approve({ requestId: request._id });
                    setCopied(false);
                    setLink({ url: result.url, email: result.email });
                  }, "Couldn't approve this request.")
                }
              >
                Approve
              </button>
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    () => decline({ requestId: request._id }).then(() => {}),
                    "Couldn't decline this request.",
                  )
                }
              >
                Decline
              </button>
            </div>
          </div>
        ))}
        {requests && requests.recent.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="min-h-11 flex items-center cursor-pointer text-[var(--reader-muted)]">
              Recently decided
            </summary>
            {requests.recent.map((request) => (
              <p key={request._id} className="py-2 text-[var(--reader-muted)]">
                {request.email} · {request.status}
                {request.decidedAt ? ` ${day(request.decidedAt)}` : ""}
              </p>
            ))}
          </details>
        )}
      </section>

      <section className="account-section">
        <h2 className="font-serif text-2xl mb-3">Unused invites</h2>
        {invites?.length === 0 && (
          <p className="text-sm text-[var(--reader-muted)]">None open.</p>
        )}
        {invites?.map((invite) => (
          <InviteRow
            key={invite._id}
            invite={invite}
            busy={busy}
            onRevoke={() =>
              run(
                () => revoke({ inviteId: invite._id }).then(() => {}),
                "Couldn't revoke this invite.",
              )
            }
          />
        ))}
      </section>

      <section className="account-section">
        <h2 className="font-serif text-2xl mb-3">Readers</h2>
        {readers?.length === 0 && (
          <p className="text-sm text-[var(--reader-muted)]">Only you so far.</p>
        )}
        {readers?.map((reader) => (
          <div key={reader._id} className={row}>
            <div className="min-w-0 text-sm">
              <p className="font-medium break-words">
                {reader.name || reader.email}{" "}
                {reader.name && (
                  <span className="text-[var(--reader-muted)] font-normal">
                    · {reader.email}
                  </span>
                )}
              </p>
              <p className="text-xs text-[var(--reader-muted)] mt-1">
                {reader.deleting
                  ? "Deleting their account"
                  : reader.status === "active"
                    ? "Active"
                    : "Disabled"}{" "}
                · joined {day(reader.createdAt)}
              </p>
            </div>
            {!reader.deleting && (
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() => {
                  const disabling = reader.status === "active";
                  if (
                    disabling &&
                    !confirm(
                      `Disable ${reader.email}? They're signed out everywhere until you enable them again.`,
                    )
                  )
                    return;
                  void run(
                    () =>
                      setStatus({
                        readerId: reader._id,
                        status: disabling ? "disabled" : "active",
                      }).then(() => {}),
                    "Couldn't change this reader's access.",
                  );
                }}
              >
                {reader.status === "active" ? "Disable" : "Enable"}
              </button>
            )}
          </div>
        ))}
      </section>
    </DeskPage>
  );
}

function InviteRow({
  invite,
  busy,
  onRevoke,
}: {
  invite: { email: string; createdAt: number; expiresAt: number };
  busy: boolean;
  onRevoke: () => void;
}) {
  const [now] = useState(() => Date.now());
  return (
    <div className={row}>
      <div className="min-w-0 text-sm">
        <p className="font-medium break-words">{invite.email}</p>
        <p className="text-xs text-[var(--reader-muted)] mt-1">
          {invite.expiresAt <= now
            ? `Expired ${day(invite.expiresAt)}`
            : `Expires ${day(invite.expiresAt)}`}
        </p>
      </div>
      <button
        type="button"
        className="app-button secondary"
        disabled={busy}
        onClick={onRevoke}
      >
        Revoke
      </button>
    </div>
  );
}
