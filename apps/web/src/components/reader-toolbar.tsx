"use client";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowLeft, Heart, MoreHorizontal, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useToolbarFade } from "@/lib/use-toolbar-fade";
import { cn } from "@/lib/utils";
import { RATINGS } from "./impression-panel";
import {
  ReaderSettingsPanel,
  type ReaderSettingsPanelProps,
} from "./reader-settings-panel";
import {
  FINISH_ARTICLE,
  OPEN_ARTICLE,
  ViewTransition,
} from "./view-transition";

const ICON = { size: 18, strokeWidth: 1.5 } as const;
const BUTTON =
  "inline-flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--reader-chip)] data-[state=open]:bg-[var(--reader-chip)] data-[state=open]:text-[var(--ink)] transition-colors";
const MENU_ITEM =
  "flex min-h-11 sm:min-h-9 cursor-default items-center justify-between gap-6 rounded-md px-2.5 py-2 font-sans text-sm text-[var(--ink)] outline-none data-[highlighted]:bg-[var(--reader-chip)]";

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="hidden sm:inline font-mono text-[11px] text-[var(--ink-muted)]">
      {children}
    </kbd>
  );
}

export interface ReaderToolbarProps {
  title: string;
  /** Absent for a PDF the reader uploaded, which has no page to open. */
  originalUrl?: string;
  /** Where Back returns to, and the room it names (Desk, Library or Notes). */
  backHref: string;
  backLabel: string;
  /** Widest the toolbar may run, matched to the article column. */
  maxWidth: string;
  noteCount: number;
  notesOpen: boolean;
  onToggleNotes: () => void;
  rating: number | undefined;
  /** Scrolls to the impression in the back matter (★ and `r`). */
  onRate: () => void;
  loved: boolean;
  onToggleLove: () => void;
  listening: boolean;
  onToggleListen: () => void;
  onToggleSummary: () => void;
  /** Only an article that was finished can be marked unread. */
  onMarkUnread: (() => void) | null;
  /** Absent for a book, whose margin is written a part at a time. */
  onReannotate: (() => void) | null;
  settings: Omit<ReaderSettingsPanelProps, "onOpenChange">;
}

/** The reader's top bar: Back, Aa, rate, love and an overflow menu. Notes lives in the menu. */
export function ReaderToolbar({
  title,
  originalUrl,
  backHref,
  backLabel,
  maxWidth,
  noteCount,
  notesOpen,
  onToggleNotes,
  rating,
  onRate,
  loved,
  onToggleLove,
  listening,
  onToggleListen,
  onToggleSummary,
  onMarkUnread,
  onReannotate,
  settings,
}: ReaderToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { hidden, focusProps } = useToolbarFade(
    menuOpen || settingsOpen || notesOpen,
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}`,
      );
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  return (
    <ViewTransition
      name="reader-toolbar"
      default="none"
      enter={{ [OPEN_ARTICLE]: "reader-toolbar", default: "none" }}
      exit={{ [FINISH_ARTICLE]: "reader-toolbar", default: "none" }}
    >
      <div
        data-testid="reader-toolbar"
        data-hidden={hidden}
        {...focusProps}
        className="reader-toolbar fixed top-0 left-0 right-[var(--notes-inset)] transition-[right] duration-200 pt-[env(safe-area-inset-top)] z-40 bg-[color-mix(in_srgb,var(--reader-bg)_82%,transparent)] backdrop-blur-sm"
      >
        <div
          className="mx-auto px-4 sm:px-6 py-2 sm:py-3 flex items-center justify-between"
          style={{ maxWidth }}
        >
          <Link
            href={backHref}
            scroll={false}
            className="flex min-h-11 sm:min-h-0 items-center gap-1.5 font-sans text-sm text-[var(--ink-soft)] hover:text-[var(--ink)] transition-colors"
            aria-label={`Back to ${backLabel}`}
          >
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
            <span className="hidden sm:inline">{backLabel}</span>
          </Link>

          <span className="sm:hidden flex-1 min-w-0 truncate px-3 font-sans text-sm text-[var(--ink-soft)]">
            {title}
          </span>

          <div className="flex items-center gap-0.5">
            <ReaderSettingsPanel {...settings} onOpenChange={setSettingsOpen} />

            <button
              type="button"
              onClick={onRate}
              className={cn(
                BUTTON,
                // The rating is the reader's own mark, so it is the one place the pen shows here.
                rating && "text-[var(--pen)] hover:text-[var(--pen)]",
              )}
              title={
                rating
                  ? `You rated this ${RATINGS[rating - 1]}`
                  : "Rate this article"
              }
              aria-label="Rate this article"
              aria-keyshortcuts="r"
            >
              <Star {...ICON} fill={rating ? "currentColor" : "none"} />
            </button>

            <button
              type="button"
              onClick={onToggleLove}
              aria-pressed={loved}
              className={cn(
                BUTTON,
                "hidden sm:inline-flex",
                loved && "text-[var(--pen)]",
              )}
              title={loved ? "Remove from loved" : "Love this article"}
              aria-label={loved ? "Remove from loved" : "Love this article"}
            >
              <Heart {...ICON} fill={loved ? "currentColor" : "none"} />
            </button>

            <DropdownMenu.Root
              modal={false}
              open={menuOpen}
              onOpenChange={setMenuOpen}
            >
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className={BUTTON}
                  aria-label="More actions"
                  title="More actions"
                >
                  <MoreHorizontal {...ICON} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  collisionPadding={12}
                  aria-label="More actions"
                  className="reader-menu z-50 w-60 p-1.5 outline-none"
                >
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={onToggleNotes}
                    aria-keyshortcuts="n"
                  >
                    Notes{noteCount > 0 ? ` · ${noteCount}` : ""}
                    <Kbd>n</Kbd>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={onToggleSummary}
                  >
                    Summary
                    <Kbd>u</Kbd>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className={MENU_ITEM}
                    onSelect={onToggleListen}
                  >
                    {listening ? "Stop listening" : "Listen"}
                    <Kbd>l</Kbd>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className={cn(MENU_ITEM, "sm:hidden")}
                    onSelect={onToggleLove}
                  >
                    {loved ? "Remove from loved" : "Love"}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 mx-1.5 h-px bg-[var(--reader-border)]" />
                  <DropdownMenu.Item className={MENU_ITEM} onSelect={copyLink}>
                    Copy link
                  </DropdownMenu.Item>
                  {originalUrl && (
                    <DropdownMenu.Item className={MENU_ITEM} asChild>
                      <a href={originalUrl} target="_blank" rel="noreferrer">
                        Open original
                      </a>
                    </DropdownMenu.Item>
                  )}
                  {onMarkUnread && (
                    <DropdownMenu.Item
                      className={MENU_ITEM}
                      onSelect={onMarkUnread}
                    >
                      Mark unread
                    </DropdownMenu.Item>
                  )}
                  {onReannotate && (
                    <>
                      <DropdownMenu.Separator className="my-1 mx-1.5 h-px bg-[var(--reader-border)]" />
                      <DropdownMenu.Item
                        className={cn(MENU_ITEM, "text-[var(--ink-soft)]")}
                        onSelect={onReannotate}
                      >
                        Re-annotate with latest vault
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>
    </ViewTransition>
  );
}
