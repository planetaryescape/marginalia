"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import {
  ArrowRight,
  Bookmark,
  BookOpen,
  ChartNoAxesColumn,
  Home,
  Keyboard,
  Library,
  Link2,
  NotebookPen,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { InstallApp } from "@/components/install-app";
import { emitCommand } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

export function useSiteNav(): NavItem[] {
  const savedCount = useQuery(api.savedArticles.count);
  return [
    { href: "/library", label: "Library" },
    { href: "/notes", label: "Notes" },
    { href: "/reading", label: "This week" },
    { href: "/saved", label: savedCount ? `Saved · ${savedCount}` : "Saved" },
    { href: "/feeds", label: "Sources" },
  ];
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

/** Wordmark, page links and the paste-a-link field, shared by home and library. */
export function SiteHeader({ showPaste = true }: { showPaste?: boolean }) {
  const nav = useSiteNav();
  const pathname = usePathname();
  return (
    <header className="shrink-0 mx-auto w-full max-w-[1180px] px-5 md:px-10 h-14 md:h-16 flex items-center gap-4 md:gap-6">
      <Link
        href="/"
        data-reader-transition
        className="font-serif text-[21px] md:text-[22px] tracking-tight shrink-0"
      >
        Marginalia
      </Link>
      <nav
        aria-label="Main navigation"
        className="hidden md:flex items-center gap-5 text-[13px] text-[var(--reader-muted)]"
      >
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            data-reader-transition
            aria-current={pathname === item.href ? "page" : undefined}
            className="hover:text-[var(--reader-fg)] transition-colors aria-[current=page]:text-[var(--reader-fg)]"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {showPaste && (
        <div className="ml-auto w-full max-w-[280px] min-w-0">
          <PasteLink />
        </div>
      )}
      <div className={`flex items-center gap-1 ${showPaste ? "" : "ml-auto"}`}>
        <Link
          href="/account"
          data-reader-transition
          aria-label="Your account"
          className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
        >
          <UserRound size={19} />
        </Link>
        <InstallApp />
        <button
          type="button"
          aria-label="Keyboard shortcuts"
          aria-keyshortcuts="Shift+/"
          title="Keyboard shortcuts (?)"
          onClick={() => emitCommand("open-shortcuts")}
          className="hidden md:flex shrink-0 h-8 w-8 items-center justify-center rounded-lg text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
        >
          <Keyboard size={17} />
        </button>
      </div>
    </header>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const mobile = [{ href: "/", label: "Home" }, ...items];
  const icons = {
    "/": Home,
    "/library": Library,
    "/notes": NotebookPen,
    "/reading": ChartNoAxesColumn,
    "/saved": Bookmark,
    "/feeds": BookOpen,
  };
  return (
    <nav
      aria-label="Main navigation"
      className="mobile-app-nav md:hidden shrink-0 px-1 pb-[env(safe-area-inset-bottom)] grid grid-cols-6 border-t border-[var(--reader-border)] bg-[var(--reader-surface)] text-[10px] min-[390px]:text-[11px] text-[var(--reader-muted)]"
    >
      {mobile.map((item) => {
        const Icon = icons[item.href as keyof typeof icons];
        return (
          <Link
            key={item.href}
            href={item.href}
            data-reader-transition
            aria-current={pathname === item.href ? "page" : undefined}
            className="flex flex-col min-h-14 min-w-0 items-center justify-center gap-1 px-0.5 text-center whitespace-nowrap hover:text-[var(--reader-fg)] aria-[current=page]:text-[var(--reader-fg)]"
          >
            {Icon && (
              <Icon
                size={20}
                strokeWidth={pathname === item.href ? 2.25 : 1.6}
                aria-hidden
              />
            )}
            <span>
              {item.href === "/reading"
                ? "Activity"
                : item.href === "/saved"
                  ? "Saved"
                  : item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
