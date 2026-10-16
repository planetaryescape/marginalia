"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction } from "convex/react";
import {
  ArrowRight,
  Home,
  Library,
  Link2,
  NotebookPen,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AccountMenu } from "@/components/account-menu";
import { emitCommand } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * The rooms in the header and on the phone bar. Desk is the wordmark. Your
 * reading is never linked from the reader or Notes (D-DES-060).
 */
export const ROOMS: NavItem[] = [
  { href: "/library", label: "Library" },
  { href: "/notes", label: "Notes" },
  { href: "/reading", label: "Your reading" },
];

/** A room is current on its own path and anything beneath it. */
export function isCurrentRoom(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PasteLink({ large = false }: { large?: boolean }) {
  const router = useRouter();
  const addByUrl = useAction(api.actions.addArticleByUrl.add);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || adding) return;
    setAdding(true);
    try {
      const { articleId, alreadyExists } = await addByUrl({ url: url.trim() });
      toast.success(
        alreadyExists
          ? "Already in your library. Opening it."
          : "Added. Marginalia is on its way.",
      );
      setUrl("");
      router.push(`/read/${articleId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't fetch that article",
      );
    }
    setAdding(false);
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "focus-frame flex items-center gap-2 rounded-full bg-[var(--reader-chip)] ring-1 ring-[var(--reader-border)] focus-within:ring-[var(--reader-focus)] transition-shadow",
        large ? "h-12 pl-5 pr-1.5 w-full max-w-xl" : "h-9 pl-3.5 pr-1 w-full",
      )}
    >
      <Link2
        size={large ? 16 : 14}
        className="shrink-0 text-[var(--reader-muted)]"
      />
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste a link to read"
        aria-label="Paste a link to read"
        className={cn(
          "flex-1 min-w-0 bg-transparent outline-none text-[var(--reader-fg)] placeholder:text-[var(--reader-muted)]",
          large ? "text-[15px]" : "text-[13px]",
        )}
      />
      <button
        type="submit"
        disabled={!url.trim() || adding}
        aria-label="Read"
        className={cn(
          "shrink-0 flex items-center justify-center rounded-full bg-[var(--reader-fg)] text-[var(--reader-bg)] transition-opacity disabled:opacity-25",
          large ? "h-9 px-4 text-[13px] font-medium gap-1.5" : "w-7 h-7",
        )}
      >
        {large && (adding ? "Fetching…" : "Read")}
        {!large && <ArrowRight size={13} />}
        {large && !adding && <ArrowRight size={14} />}
      </button>
    </form>
  );
}

/** Wordmark, the three rooms and the account menu, shared by the desk frame. */
export function SiteHeader({ showPaste = true }: { showPaste?: boolean }) {
  const pathname = usePathname();
  return (
    <header className="shrink-0 mx-auto w-full max-w-[1180px] px-5 md:px-10 h-14 md:h-16 flex items-center gap-4 md:gap-6">
      <Link
        href="/"
        aria-current={pathname === "/" ? "page" : undefined}
        className={roomClass}
      >
        Marginalia
      </Link>
      <nav
        aria-label="Main navigation"
        className="hidden md:flex items-center gap-6 text-[13px] text-[var(--reader-muted)]"
      >
        {ROOMS.map((room) => {
          const current = isCurrentRoom(pathname, room.href);
          return (
            <Link
              key={room.href}
              href={room.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "hover:text-[var(--reader-fg)] transition-colors",
                current &&
                  "text-[var(--reader-fg)] underline underline-offset-[8px] decoration-[var(--reader-border-strong)]",
              )}
            >
              {room.label}
            </Link>
          );
        })}
      </nav>
      {showPaste && (
        <div className="ml-auto w-full max-w-[280px] min-w-0">
          <PasteLink />
        </div>
      )}
      <div className={cn("flex items-center", !showPaste && "ml-auto")}>
        <AccountMenu />
      </div>
    </header>
  );
}

const roomClass =
  "font-serif text-[21px] md:text-[22px] tracking-tight shrink-0 aria-[current=page]:underline aria-[current=page]:underline-offset-[8px] aria-[current=page]:decoration-[var(--reader-border-strong)]";

/**
 * Search opens the picker. The picker lives on the desk, so from another room
 * Search goes to the desk and opens it there.
 */
function useOpenFinder(pathname: string) {
  const router = useRouter();
  return () => {
    if (pathname === "/") emitCommand("open-finder");
    else router.push("/?find=1");
  };
}

/** Four slots: Desk, Library, Notes and Search. Your reading stays in the header. */
export function MobileNav() {
  const pathname = usePathname();
  const openFinder = useOpenFinder(pathname);
  const slots = [
    { href: "/", label: "Desk", Icon: Home },
    { href: "/library", label: "Library", Icon: Library },
    { href: "/notes", label: "Notes", Icon: NotebookPen },
  ];
  const slotClass =
    "flex flex-col min-h-14 min-w-0 items-center justify-center gap-1 px-0.5 text-center whitespace-nowrap hover:text-[var(--reader-fg)] aria-[current=page]:text-[var(--reader-fg)]";
  return (
    <nav
      aria-label="Main navigation"
      className="mobile-app-nav md:hidden shrink-0 px-1 pb-[env(safe-area-inset-bottom)] grid grid-cols-4 border-t border-[var(--reader-border)] bg-[var(--reader-surface)] text-[11px] text-[var(--reader-muted)]"
    >
      {slots.map(({ href, label, Icon }) => {
        const current =
          href === "/" ? pathname === "/" : isCurrentRoom(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={slotClass}
          >
            <Icon size={20} strokeWidth={current ? 2.25 : 1.6} aria-hidden />
            <span>{label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        aria-keyshortcuts="/"
        onClick={openFinder}
        className={slotClass}
      >
        <Search size={20} strokeWidth={1.6} aria-hidden />
        <span>Search</span>
      </button>
    </nav>
  );
}
