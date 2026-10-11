"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useRef } from "react";
import { ArticleFinder } from "@/components/article-finder";
import { FitChildren } from "@/components/fit-children";
import { RATINGS } from "@/components/impression-panel";
import { MobileNav, SiteHeader, useSiteNav } from "@/components/site-header";
import { useReaderSettings } from "@/lib/reader-settings";
import { moveFocus, useShortcuts } from "@/lib/shortcuts";
import { useReaderTheme } from "@/lib/use-reader-theme";

const EASE = [0.22, 1, 0.36, 1] as const;

const TIME_OPTIONS = [
  { minutes: 5, label: "Quick read" },
  { minutes: 10, label: "Coffee break" },
  { minutes: 20, label: "Focused" },
  { minutes: 30, label: "Deep dive", plus: true },
] as const;

// The margin notes use the reader's annotation colours: each kind of note
// keeps the same colour it has in the margins of an article
const ACCENTS = {
  continue: "var(--pen)",
  revisit: "#b07050",
  note: "#8b7bb0",
  sources: "#7a8f6f",
} as const;

function ago(timestamp: number) {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function MarginNote({
  label,
  accent,
  children,
  index,
}: {
  label: string;
  accent: string;
  children: ReactNode;
  index: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, x: 8, filter: "blur(3px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.5, ease: EASE, delay: 0.25 + index * 0.09 }}
      className="relative pl-4 border-l-2"
      style={{ borderColor: accent }}
    >
      {/* Connector back to the text column, as in an article's margin */}
      <span
        aria-hidden
        className="absolute top-[9px] -left-[30px] hidden lg:flex items-center w-[28px]"
      >
        <span
          className="w-[5px] h-[5px] rounded-full"
          style={{ background: accent }}
        />
        <span
          className="flex-1 h-px opacity-50"
          style={{ background: accent }}
        />
      </span>
      <p
        className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: accent }}
      >
        {label}
      </p>
      <div className="mt-1.5">{children}</div>
    </motion.section>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { settings } = useReaderSettings();
  useReaderTheme(settings);
  const reduced = useReducedMotion();
  const upNextRef = useRef<HTMLDivElement>(null);

  const overview = useQuery(api.home.overview, {});
  const inProgress = useQuery(api.sessions.getInProgress);
  const dueForReview = useQuery(api.lovedArticles.getDueForReview);
  const impressions = useQuery(api.impressions.listRecent, {});
  const feeds = useQuery(api.feeds.list);
  const readwise = useQuery(api.readwise.status, {});
  const createSession = useMutation(api.sessions.create);
  const advanceReview = useMutation(api.lovedArticles.advanceReview);
  const snoozeReview = useMutation(api.lovedArticles.snooze);
  const nav = useSiteNav();

  const startSession = async (minutes: number) => {
    const sessionId = await createSession({ requestedMinutes: minutes });
    router.push(`/session/${sessionId}`);
  };

  const loading = overview === undefined;
  const hasArticles = (overview?.annotatedTotal ?? 0) > 0;
  const hasSources = Boolean(feeds?.length) || Boolean(readwise?.connected);
  const revisit = dueForReview?.filter((entry) => entry !== null)[0] ?? null;
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const visibleUpNext = () =>
    Array.from(
      upNextRef.current?.querySelectorAll<HTMLElement>("[data-upnext-link]") ??
        [],
    ).filter(
      (el) =>
        el.closest<HTMLElement>("[role=listitem]")?.style.visibility !==
        "hidden",
    );

  useShortcuts(
    {
      "1": () => startSession(5),
      "2": () => startSession(10),
      "3": () => startSession(20),
      "4": () => startSession(30),
      c: () => {
        if (inProgress) router.push(`/read/${inProgress.article._id}`);
      },
      j: () => moveFocus(visibleUpNext(), 1),
      k: () => moveFocus(visibleUpNext(), -1),
    },
    !loading,
  );

  const rise: Variants = {
    hidden: reduced ? {} : { opacity: 0, y: 10 },
    show: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.55, ease: EASE, delay: i * 0.06 },
    }),
  };

  const groupLabel =
    "text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--reader-muted)]";

  const marginNotes: ReactNode[] = [];
  if (overview?.latestNote) {
    const note = overview.latestNote;
    marginNotes.push(
      <MarginNote
        key="note"
        label="From your notes"
        accent={ACCENTS.note}
        index={marginNotes.length}
      >
        {note.selectedText && (
          <p className="font-serif italic text-[14.5px] leading-snug text-[var(--reader-muted)] line-clamp-2">
            “{note.selectedText}”
          </p>
        )}
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--reader-fg-soft)] line-clamp-3">
          {note.text}
        </p>
        <p className="mt-2 text-[12px] text-[var(--reader-muted)] truncate">
          {ago(note.createdAt)}
          {note.articleTitle && (
            <>
              {" · "}
              <Link
                href={`/read/${note.articleId}`}
                className="hover:text-[var(--reader-fg)] underline decoration-[var(--reader-border-strong)] underline-offset-2"
              >
                {note.articleTitle}
              </Link>
            </>
          )}
        </p>
      </MarginNote>,
    );
  }
  const rated = (impressions ?? []).filter((item) => item.rating).slice(0, 2);
  if (rated.length) {
    marginNotes.push(
      <MarginNote
        key="impressions"
        label="Recently rated"
        accent={ACCENTS.continue}
        index={marginNotes.length}
      >
        <ul className="space-y-2">
          {rated.map((item) => (
            <li key={item._id}>
              <Link
                href={`/read/${item.articleId}`}
                className="block font-serif text-[15.5px] leading-snug line-clamp-1 hover:text-[var(--pen)]"
              >
                {item.title}
              </Link>
              <p className="text-[12px] text-[var(--reader-muted)] truncate">
                {item.rating ? RATINGS[item.rating - 1] : ""}
                {item.note
                  ? ` · “${item.note}”`
                  : item.tags.length
                    ? ` · ${item.tags.join(", ")}`
                    : ""}
              </p>
            </li>
          ))}
        </ul>
      </MarginNote>,
    );
  }
  marginNotes.push(
    <MarginNote
      key="sources"
      label="Where it comes from"
      accent={ACCENTS.sources}
      index={marginNotes.length}
    >
      <p className="text-[13px] text-[var(--reader-fg-soft)]">
        Readwise Reader
        <span className="text-[var(--reader-muted)]">
          {" · "}
          {!readwise?.connected
            ? "not connected"
            : readwise.error
              ? "last sync failed"
              : readwise.syncedAt
                ? `synced ${ago(readwise.syncedAt)}`
                : "connected"}
        </span>
      </p>
      <p className="text-[13px] text-[var(--reader-fg-soft)]">
        {feeds?.length ?? 0} RSS {feeds?.length === 1 ? "feed" : "feeds"}
        <span className="text-[var(--reader-muted)]"> · </span>
        <Link
          href="/feeds"
          className="text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
        >
          manage
        </Link>
      </p>
    </MarginNote>,
  );
  marginNotes.push(
    <p
      key="keys"
      className="hidden lg:block pl-[18px] text-[12px] text-[var(--reader-muted)]"
    >
      Press <kbd className="reader-kbd">?</kbd> for keyboard shortcuts
    </p>,
  );

  return (
    // One screen, no scrolling: every region sizes to the viewport and long
    // lists show only what fits
    <div className="h-dvh flex flex-col overflow-hidden bg-[var(--reader-bg)] text-[var(--reader-fg)] font-sans">
      <SiteHeader showPaste={false} />

      <main className="flex-1 min-h-0 mx-auto w-full max-w-[1180px] px-5 md:px-10 pt-[clamp(0.75rem,4vh,3rem)] pb-[clamp(1rem,3vh,2rem)]">
        {loading ? null : !hasArticles ? (
          /* First run: nothing annotated yet */
          <motion.div
            initial="hidden"
            animate="show"
            className="h-full flex flex-col justify-center max-w-2xl pb-[8vh]"
          >
            <motion.p
              custom={0}
              variants={rise}
              className="text-[12.5px] text-[var(--reader-muted)]"
            >
              {today}
            </motion.p>
            <motion.h1
              custom={1}
              variants={rise}
              className="mt-3 font-serif font-light tracking-tight leading-[1.05] text-[clamp(2.25rem,min(5.5vw,8vh),4.25rem)]"
            >
              {hasSources
                ? "Your first articles are on their way."
                : "Bring something to read."}
            </motion.h1>
            <motion.p
              custom={2}
              variants={rise}
              className="mt-5 max-w-lg text-[15px] leading-relaxed text-[var(--reader-fg-soft)]"
            >
              {hasSources
                ? "Each article is annotated against your notes before it appears here, which takes a minute or two. Paste a link to read one straight away."
                : "Paste a link, connect Readwise Reader, or add RSS feeds. Marginalia annotates each article against your notes before you read it."}
            </motion.p>
            <motion.div custom={3} variants={rise} className="mt-8 max-w-xl">
              <ArticleFinder />
            </motion.div>
            {!hasSources && (
              <motion.div
                custom={4}
                variants={rise}
                className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px]"
              >
                <Link
                  href="/feeds"
                  className="text-[var(--pen)] hover:underline"
                >
                  Connect Readwise Reader
                </Link>
                <Link
                  href="/feeds"
                  className="text-[var(--pen)] hover:underline"
                >
                  Add RSS feeds
                </Link>
              </motion.div>
            )}
          </motion.div>
        ) : (
          <div className="h-full grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-[72px]">
            {/* Every way of finding something to read, together */}
            <motion.div
              initial="hidden"
              animate="show"
              className="min-h-0 min-w-0 flex flex-col"
              aria-label="Find something to read"
              role="region"
            >
              <motion.p
                custom={0}
                variants={rise}
                className="shrink-0 text-[12.5px] text-[var(--reader-muted)]"
              >
                {today}
                <span className="mx-2 opacity-50">·</span>
                <span className="text-[var(--reader-fg-soft)]">
                  {overview.waiting === 0
                    ? "You're all caught up"
                    : `${overview.waiting} ${overview.waiting === 1 ? "piece" : "pieces"} waiting`}
                  <span className="hidden sm:inline">
                    {overview.waiting === 0
                      ? ""
                      : ", annotated against your notes"}
                  </span>
                </span>
              </motion.p>
              <motion.h1
                custom={1}
                variants={rise}
                className="shrink-0 mt-[clamp(0.25rem,1.2vh,0.75rem)] font-serif font-light tracking-tight leading-[1.02] text-[clamp(2rem,min(5.6vw,6.6vh),4.5rem)]"
              >
                How much time
                <br className="hidden sm:block" /> do you have?
              </motion.h1>

              <motion.div
                custom={2}
                variants={rise}
                className="shrink-0 mt-[clamp(0.9rem,3.2vh,2.25rem)] grid grid-cols-4 gap-2 sm:gap-3"
              >
                {TIME_OPTIONS.map((option, i) => {
                  const fits = overview.fits[option.minutes];
                  return (
                    <button
                      key={option.minutes}
                      type="button"
                      onClick={() => startSession(option.minutes)}
                      aria-keyshortcuts={String(i + 1)}
                      className="group relative flex flex-col items-start min-w-0 rounded-xl sm:rounded-2xl bg-[var(--reader-surface)] ring-1 ring-[var(--reader-border)] px-3 sm:px-5 py-[clamp(0.55rem,1.6vh,0.95rem)] text-left transition-all duration-200 hover:-translate-y-0.5 hover:ring-[var(--pen)] hover:shadow-[0_14px_40px_-22px_rgba(0,0,0,0.45)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--reader-focus)]"
                    >
                      <kbd
                        aria-hidden
                        className="reader-kbd hidden sm:block absolute top-2.5 right-2.5 opacity-60 group-hover:opacity-100 group-focus-visible:opacity-100"
                      >
                        {i + 1}
                      </kbd>
                      <span className="flex items-baseline gap-0.5 sm:gap-1">
                        <span className="font-serif font-light leading-none tracking-tight text-[clamp(1.8rem,min(4vw,5.4vh),3.1rem)] transition-colors group-hover:text-[var(--pen)]">
                          {option.minutes}
                        </span>
                        <span className="font-serif text-[13px] sm:text-[17px] text-[var(--reader-muted)]">
                          {"plus" in option ? "+" : ""}
                          <span className="hidden sm:inline"> min</span>
                        </span>
                      </span>
                      <span className="hidden sm:block mt-[clamp(0.2rem,1vh,0.6rem)] text-[13.5px] text-[var(--reader-fg-soft)] truncate max-w-full">
                        {option.label}
                      </span>
                      <span className="mt-1 sm:mt-0 text-[11px] sm:text-[11.5px] text-[var(--reader-muted)]">
                        {fits === 0 ? "none" : `${fits} fit`}
                      </span>
                    </button>
                  );
                })}
              </motion.div>

              <motion.div
                custom={3}
                variants={rise}
                className="shrink-0 mt-2 sm:mt-3"
              >
                <ArticleFinder />
              </motion.div>

              {(inProgress || revisit) && (
                <motion.div
                  custom={4}
                  variants={rise}
                  className="shrink-0 mt-[clamp(0.9rem,3vh,2rem)] grid gap-2 sm:gap-3 sm:grid-cols-2"
                >
                  {inProgress && (
                    <Link
                      href={`/read/${inProgress.article._id}`}
                      aria-keyshortcuts="c"
                      className="group relative block rounded-xl pl-4 pr-10 py-2.5 border-l-2 bg-[var(--reader-chip)] hover:bg-[var(--reader-surface)] transition-colors"
                      style={{ borderColor: ACCENTS.continue }}
                    >
                      <kbd
                        aria-hidden
                        className="reader-kbd hidden sm:block absolute top-2.5 right-2.5 opacity-60"
                      >
                        c
                      </kbd>
                      <span
                        className="block text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                        style={{ color: ACCENTS.continue }}
                      >
                        Continue reading
                      </span>
                      <span className="mt-0.5 block font-serif text-[16px] leading-snug truncate group-hover:text-[var(--pen)]">
                        {inProgress.article.title}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2 text-[11.5px] text-[var(--reader-muted)]">
                        <span className="h-[3px] w-16 rounded-full bg-[var(--reader-border)] overflow-hidden">
                          <span
                            className="block h-full rounded-full bg-[var(--pen)]"
                            style={{
                              width: `${Math.max(4, inProgress.scrollPercent)}%`,
                            }}
                          />
                        </span>
                        {inProgress.remainingMinutes
                          ? `about ${inProgress.remainingMinutes} min left`
                          : `${inProgress.scrollPercent}% read`}
                      </span>
                    </Link>
                  )}
                  {revisit && (
                    <div
                      className="rounded-xl pl-4 pr-3 py-2.5 border-l-2 bg-[var(--reader-chip)]"
                      style={{ borderColor: ACCENTS.revisit }}
                    >
                      <span
                        className="block text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                        style={{ color: ACCENTS.revisit }}
                      >
                        Worth revisiting · loved {revisit.daysSinceLastRead}{" "}
                        days ago
                      </span>
                      <div className="mt-0.5 flex items-center gap-3">
                        <Link
                          href={`/read/${revisit.articleId}`}
                          onClick={() =>
                            advanceReview({
                              articleId: revisit.articleId as Id<"articles">,
                            })
                          }
                          className="min-w-0 flex-1 font-serif text-[16px] leading-snug truncate hover:text-[var(--pen)]"
                        >
                          {revisit.article.title}
                        </Link>
                        <button
                          type="button"
                          onClick={() =>
                            snoozeReview({
                              articleId: revisit.articleId as Id<"articles">,
                            })
                          }
                          className="shrink-0 h-6 px-2.5 rounded-full ring-1 ring-[var(--reader-border-strong)] text-[11.5px] text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
                        >
                          Not now
                        </button>
                      </div>
                      <span className="mt-1.5 block text-[11.5px] text-[var(--reader-muted)]">
                        Reread it to keep it fresh
                      </span>
                    </div>
                  )}
                </motion.div>
              )}

              {overview.upNext.length > 0 && (
                <motion.section
                  custom={5}
                  variants={rise}
                  className="flex-1 min-h-0 flex flex-col mt-[clamp(0.9rem,3.4vh,2.5rem)]"
                >
                  <h2
                    className={`shrink-0 ${groupLabel} flex items-center gap-2`}
                  >
                    Up next
                    <span className="hidden sm:inline font-normal normal-case tracking-normal">
                      <kbd className="reader-kbd">j</kbd>{" "}
                      <kbd className="reader-kbd">k</kbd>
                    </span>
                  </h2>
                  <div ref={upNextRef} className="flex-1 min-h-0 flex flex-col">
                    <FitChildren
                      label="Up next"
                      className="flex-1 mt-2 border-t border-[var(--reader-border)]"
                    >
                      {overview.upNext.map((article) => (
                        <Link
                          key={article._id}
                          href={`/read/${article._id}`}
                          data-upnext-link
                          className="group flex items-baseline gap-6 py-3 px-2 -mx-2 rounded-md border-b border-[var(--reader-border)] outline-none focus-visible:bg-[var(--reader-chip)]"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block font-serif text-[17px] sm:text-[18px] leading-snug truncate transition-colors group-hover:text-[var(--pen)]">
                              {article.title}
                            </span>
                            <span className="mt-0.5 block text-[12px] text-[var(--reader-muted)] truncate">
                              {[
                                article.author,
                                article.source?.toLowerCase() ===
                                article.author?.toLowerCase()
                                  ? null
                                  : article.source,
                                article.fromReader ? "from Reader" : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-[var(--reader-muted)]">
                            {article.minutes ? `${article.minutes} min` : ""}
                          </span>
                        </Link>
                      ))}
                    </FitChildren>
                  </div>
                </motion.section>
              )}
            </motion.div>

            {/* Margin: reflection on what you've read, not ways in */}
            <aside className="hidden lg:flex min-h-0 flex-col pt-[clamp(0rem,4.5vh,2.6rem)]">
              <FitChildren className="flex-1 -ml-8 pl-8 flex flex-col gap-[clamp(1.25rem,4vh,2.25rem)]">
                {marginNotes}
              </FitChildren>
            </aside>
          </div>
        )}
      </main>

      <MobileNav items={nav} />
    </div>
  );
}
