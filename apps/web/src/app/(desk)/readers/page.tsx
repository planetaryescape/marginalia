"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { Check } from "lucide-react";
import { useState } from "react";
import { ConfirmAction } from "@/components/settings-confirm";
import {
  fieldControl,
  primaryControl,
  quietControl,
  settingsRow,
  textControl,
} from "@/components/settings-controls";
import { SettingsPage, SettingsSection } from "@/components/settings-section";

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
  const [confirming, setConfirming] = useState<string | null>(null);

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

  if (me === undefined)
    return (
      <SettingsPage page="Readers" title="Readers">
        {null}
      </SettingsPage>
    );
  if (!isOwner)
    return (
      <SettingsPage page="Readers" title="Readers">
        <p className="text-sm text-[var(--reader-muted)]">
          Only the reader's owner can manage access.
        </p>
      </SettingsPage>
    );

  const waiting = requests?.pending.length ?? 0;

  return (
    <SettingsPage page="Readers" title="Readers">
      {link && (
        <div
          className="mb-12 rounded-md bg-[var(--reader-chip)] p-4"
          aria-live="polite"
        >
          <p className="text-sm font-medium">Invite link for {link.email}</p>
          <p className="mt-1 mb-3 text-[13px] text-[var(--reader-muted)]">
            Copy it now. It won't be shown again; revoke and re-approve if it's
            lost.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              readOnly
              className={`${fieldControl} min-w-0 flex-1 font-mono text-xs`}
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Invite link"
            />
            <button
              type="button"
              className={quietControl}
              onClick={async () => {
                await navigator.clipboard.writeText(link.url);
                setCopied(true);
              }}
            >
              {copied ? <Check size={16} aria-hidden /> : null}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className={textControl}
              onClick={() => {
                setLink(null);
                setCopied(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="alert" className="mb-8 text-sm text-[var(--danger)]">
          {message}
        </p>
      )}

      <SettingsSection
        title="Requests"
        status={
          waiting > 0
            ? { tone: "quiet", label: `${waiting} waiting` }
            : undefined
        }
        description="Approve a request to create a one-time invite link, valid for 7 days. Send it to the person yourself; it's shown only once."
        details={
          requests && requests.recent.length > 0 ? (
            <div>
              {requests.recent.map((request) => (
                <p key={request._id}>
                  {request.email} · {request.status}
                  {request.decidedAt ? ` ${day(request.decidedAt)}` : ""}
                </p>
              ))}
            </div>
          ) : undefined
        }
      >
        {requests?.pending.length === 0 && (
          <p className="text-sm text-[var(--reader-muted)]">
            No one is waiting.
          </p>
        )}
        <div>
          {requests?.pending.map((request) => (
            <div key={request._id} className={settingsRow}>
              <div className="min-w-0 text-sm">
                <p className="font-medium break-words">
                  {request.name}{" "}
                  <span className="font-normal text-[var(--reader-muted)]">
                    · {request.email}
                  </span>
                </p>
                {request.note && (
                  <p className="mt-1 break-words text-[var(--reader-muted)]">
                    {request.note}
                  </p>
                )}
                <p className="mt-1 text-[13px] text-[var(--reader-muted)]">
                  Asked {day(request.createdAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={primaryControl}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await approve({
                        requestId: request._id,
                      });
                      setCopied(false);
                      setLink({ url: result.url, email: result.email });
                    }, "Couldn't approve this request.")
                  }
                >
                  Approve
                </button>
                <button
                  type="button"
                  className={quietControl}
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
        </div>
      </SettingsSection>

      <SettingsSection
        title="Unused invites"
        description={invites?.length === 0 ? "None open." : undefined}
      >
        <div>
          {invites?.map((invite) => (
            <div key={invite._id} className={settingsRow}>
              <div className="min-w-0 text-sm">
                <p className="font-medium break-words">{invite.email}</p>
                <p className="mt-1 text-[13px] text-[var(--reader-muted)]">
                  {invite.expiresAt <= Date.now()
                    ? `Expired ${day(invite.expiresAt)}`
                    : `Expires ${day(invite.expiresAt)}`}
                </p>
              </div>
              <button
                type="button"
                className={quietControl}
                disabled={busy}
                onClick={() =>
                  run(
                    () => revoke({ inviteId: invite._id }).then(() => {}),
                    "Couldn't revoke this invite.",
                  )
                }
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Readers"
        description={readers?.length === 0 ? "Only you so far." : undefined}
      >
        <div>
          {readers?.map((reader) => {
            const key = `reader:${reader._id}`;
            return (
              <div key={reader._id} className={settingsRow}>
                <div className="min-w-0 text-sm">
                  <p className="font-medium break-words">
                    {reader.name || reader.email}{" "}
                    {reader.name && (
                      <span className="font-normal text-[var(--reader-muted)]">
                        · {reader.email}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[13px] text-[var(--reader-muted)]">
                    {reader.deleting
                      ? "Deleting their account"
                      : reader.status === "active"
                        ? "Active"
                        : "Disabled"}{" "}
                    · joined {day(reader.createdAt)}
                  </p>
                </div>
                {!reader.deleting &&
                  (reader.status === "active" ? (
                    <ConfirmAction
                      label="Disable"
                      ariaLabel={`Disable ${reader.email}`}
                      question={`Disable ${reader.email}? They're signed out everywhere until you enable them again.`}
                      confirmLabel="Disable"
                      busy={busy}
                      open={confirming === key}
                      onOpenChange={(open) => setConfirming(open ? key : null)}
                      onConfirm={() =>
                        void run(
                          () =>
                            setStatus({
                              readerId: reader._id,
                              status: "disabled",
                            }).then(() => {}),
                          "Couldn't change this reader's access.",
                        )
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      className={quietControl}
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            setStatus({
                              readerId: reader._id,
                              status: "active",
                            }).then(() => {}),
                          "Couldn't change this reader's access.",
                        )
                      }
                    >
                      Enable
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
