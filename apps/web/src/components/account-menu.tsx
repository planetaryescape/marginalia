"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "convex/react";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { InstallAppContent, useInstallPrompt } from "@/components/install-app";
import { ago } from "@/components/readwise-card";
import { SOURCE_URL } from "@/components/source-link";
import { emitCommand } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

const MENU_ITEM =
  "flex min-h-11 sm:min-h-9 cursor-default items-center justify-between gap-6 rounded-md px-2.5 py-2 font-sans text-sm text-[var(--ink)] outline-none data-[highlighted]:bg-[var(--reader-chip)]";
const HAIRLINE = "my-1 mx-1.5 h-px bg-[var(--reader-border)]";

interface ReadwiseStatus {
  connected: boolean;
  syncedAt: number | null;
  error: string | null;
}
interface FeedStatus {
  title: string;
  lastError?: string;
}

/**
 * One sentence for the avatar menu's status line. A failure takes the line
 * over, because a failed source is the only thing the menu should shout about.
 */
export function sourceStatus(
  readwise: ReadwiseStatus | null | undefined,
  feeds: FeedStatus[] | undefined,
): { line: string; failed: boolean } {
  const failing = feeds?.filter((feed) => feed.lastError) ?? [];
  if (readwise?.error) return { line: "Readwise sync failed.", failed: true };
  if (failing.length === 1)
    return {
      line: `“${failing[0].title}” couldn’t be fetched.`,
      failed: true,
    };
  if (failing.length > 1)
    return {
      line: `${failing.length} sources couldn’t be fetched.`,
      failed: true,
    };

  const parts: string[] = [];
  if (readwise) {
    if (!readwise.connected) parts.push("Readwise not connected");
    else if (readwise.syncedAt)
      parts.push(`Readwise synced ${ago(readwise.syncedAt)}`);
    else parts.push("Readwise first sync pending");
  }
  if (feeds) {
    parts.push(
      feeds.length === 0
        ? "No sources yet"
        : `${feeds.length} ${feeds.length === 1 ? "source" : "sources"}`,
    );
  }
  return { line: parts.join(" · "), failed: false };
}

/**
 * The avatar at the right of the header. It holds the settings pages (Sources,
 * Readers for the owner, Account) and the rarely used actions, and shows one
 * line of source status. Only a failed source marks the avatar.
 */
export function AccountMenu() {
  const reader = useQuery(api.auth.currentReader, {});
  const readwise = useQuery(api.readwise.status, {});
  const feeds = useQuery(api.feeds.list, {});
  const isOwner = reader?.isOwner === true;
  const requests = useQuery(api.waitlist.listRequests, isOwner ? {} : "skip");
  const waiting = requests?.pending.length ?? 0;
  const { installed, prompt, clearPrompt } = useInstallPrompt();
  const [menuOpen, setMenuOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const status = sourceStatus(readwise, feeds);

  useEffect(() => {
    if (installed) setInstallOpen(false);
  }, [installed]);

  return (
    <Popover.Root open={installOpen} onOpenChange={setInstallOpen}>
      <DropdownMenu.Root
        modal={false}
        open={menuOpen}
        onOpenChange={setMenuOpen}
      >
        <Popover.Anchor asChild>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={
                status.failed ? "Account, a source needs attention" : "Account"
              }
              title="Account"
              className="relative flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-full ring-1 ring-[var(--reader-border-strong)] text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
            >
              <UserRound size={17} />
              {status.failed && (
                <span
                  aria-hidden
                  data-source-status="failed"
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--danger)] ring-2 ring-[var(--reader-bg)]"
                />
              )}
            </button>
          </DropdownMenu.Trigger>
        </Popover.Anchor>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="reader-menu z-50 w-72 max-w-[calc(100vw-24px)] p-1.5 outline-none"
          >
            <DropdownMenu.Label className="px-2.5 pt-2 pb-2.5 font-normal">
              <span className="block truncate text-sm font-medium text-[var(--ink)]">
                {reader?.email}
              </span>
              {isOwner && (
                <span className="block text-xs text-[var(--reader-muted)]">
                  Owner
                </span>
              )}
              <span
                className={cn(
                  "mt-1.5 block text-xs leading-snug",
                  status.failed
                    ? "text-[var(--danger)]"
                    : "text-[var(--reader-muted)]",
                )}
              >
                {status.line}
              </span>
            </DropdownMenu.Label>
            <DropdownMenu.Separator className={HAIRLINE} />
            {/* The header shows Your reading from md up; the phone bar has no slot for it */}
            <DropdownMenu.Item className={cn(MENU_ITEM, "md:hidden")} asChild>
              <Link href="/reading">Your reading</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} asChild>
              <Link href="/feeds">Sources</Link>
            </DropdownMenu.Item>
            {isOwner && (
              <DropdownMenu.Item className={MENU_ITEM} asChild>
                <Link href="/readers">
                  Readers
                  {waiting > 0 && (
                    <span className="text-[var(--reader-muted)]">
                      {waiting} waiting
                    </span>
                  )}
                </Link>
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item className={MENU_ITEM} asChild>
              <Link href="/account">Account</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={HAIRLINE} />
            {!installed && (
              <DropdownMenu.Item
                className={MENU_ITEM}
                onSelect={() => setInstallOpen(true)}
              >
                Install app
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              className={MENU_ITEM}
              onSelect={() => emitCommand("open-shortcuts")}
            >
              Keyboard shortcuts
              <kbd className="reader-kbd text-[11px]">?</kbd>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} asChild>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                About Marginalia
              </a>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {!installed && (
        <InstallAppContent
          prompt={prompt}
          clearPrompt={clearPrompt}
          onDone={() => setInstallOpen(false)}
        />
      )}
    </Popover.Root>
  );
}
