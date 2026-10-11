"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { ArrowRight, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { FitChildren } from "@/components/fit-children";
import {
  MobileNav,
  PasteLink,
  SiteHeader,
  useSiteNav,
} from "@/components/site-header";
import { useReaderSettings } from "@/lib/reader-settings";
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

  const overview = useQuery(api.home.overview, {});
  const inProgress = useQuery(api.sessions.getInProgress);
  const dueForReview = useQuery(api.lovedArticles.getDueForReview);
  const savedCount = useQuery(api.savedArticles.count);
  const feeds = useQuery(api.feeds.list);
  const readwise = useQuery(api.readwise.status, {});
  const createSession = useMutation(api.sessions.create);
  const advanceReview = useMutation(api.lovedArticles.advanceReview);
  const snoozeReview = useMutation(api.lovedArticles.snooze);

  const startSession = async (minutes: number) => {
    const sessionId = await createSession({ requestedMinutes: minutes });
    router.push(`/session/${sessionId}`);
  };

  const loading = overview === undefined;
  const hasArticles = (overview?.annotatedTotal ?? 0) > 0;
  const hasSources = Boolean(feeds?.length) || Boolean(readwise?.connected);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const rise: Variants = {
    hidden: reduced ? {} : { opacity: 0, y: 10 },
    show: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.55, ease: EASE, delay: i * 0.06 },
    }),
  };

  const nav = useSiteNav();

  const continueReading = inProgress && (
    <Link href={`/read/${inProgress.article._id}`} className="group block">
      <span className="block font-serif text-[17px] leading-snug line-clamp-2 group-hover:text-[var(--pen)] transition-colors">
        {inProgress.article.title}
      </span>
      <span className="mt-2.5 block h-[3px] rounded-full bg-[var(--reader-chip)] overflow-hidden">
        <span
          className="block h-full rounded-full bg-[var(--pen)]"
          style={{ width: `${Math.max(3, inProgress.scrollPercent)}%` }}
        />
      </span>
      <span className="mt-1.5 block text-[12px] text-[var(--reader-muted)]">
        {inProgress.scrollPercent}% read
        {inProgress.remainingMinutes
          ? ` · about ${inProgress.remainingMinutes} min left`
          : ""}
      </span>
    </Link>
  );

  const marginNotes: ReactNode[] = [];
  if (continueReading) {
    marginNotes.push(
      <MarginNote
        key="continue"
        label="Continue reading"
        accent={ACCENTS.continue}
        index={marginNotes.length}
      >
        {continueReading}
      </MarginNote>,
    );
  }
  for (const item of dueForReview?.filter((entry) => entry !== null) ?? []) {
    marginNotes.push(
      <MarginNote
        key={item._id}
        label="Worth revisiting"
        accent={ACCENTS.revisit}
        index={marginNotes.length}
      >
        <p className="font-serif text-[17px] leading-snug line-clamp-2">
          {item.article.title}
        </p>
        <p className="mt-1 text-[12px] text-[var(--reader-muted)]">
          You loved this {item.daysSinceLastRead} days ago
        </p>
        <div className="mt-2.5 flex gap-2">
          <Link
            href={`/read/${item.articleId}`}
            onClick={() =>
              advanceReview({ articleId: item.articleId as Id<"articles"> })
            }
            className="h-7 px-3 inline-flex items-center rounded-full bg-[var(--reader-fg)] text-[var(--reader-bg)] text-[12px] font-medium hover:opacity-90 transition-opacity"
          >
            Read again
          </Link>
          <button
            type="button"
            onClick={() =>
              snoozeReview({ articleId: item.articleId as Id<"articles"> })
            }
            className="h-7 px-3 rounded-full ring-1 ring-[var(--reader-border-strong)] text-[12px] text-[var(--reader-muted)] hover:text-[var(--reader-fg)] transition-colors"
          >
            Not now
          </button>
        </div>
      </MarginNote>,
    );
  }
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

  return (
    // One screen, no scrolling: every region sizes to the viewport and long
    // lists show only what fits
    <div className="h-dvh flex flex-col overflow-hidden bg-[var(--reader-bg)] text-[var(--reader-fg)] font-sans">
      <SiteHeader showPaste={hasArticles} />

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
            <motion.div custom={3} variants={rise} className="mt-8">
              <PasteLink large />
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
            {/* Text column */}
            <motion.div
              initial="hidden"
              animate="show"
              className="min-h-0 min-w-0 flex flex-col"
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
                className="shrink-0 mt-[clamp(0.25rem,1.2vh,0.75rem)] font-serif font-light tracking-tight leading-[1.02] text-[clamp(2.1rem,min(6vw,7.4vh),4.75rem)]"
              >
                How much time
                <br className="hidden sm:block" /> do you have?
              </motion.h1>

              {continueReading && (
                <motion.div
                  custom={2}
                  variants={rise}
                  className="lg:hidden shrink-0 mt-[clamp(0.75rem,2.5vh,1.5rem)] pl-4 border-l-2"
                  style={{ borderColor: ACCENTS.continue }}
                >
                  <p
                    className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: ACCENTS.continue }}
                  >
                    Continue reading
                  </p>
                  <div className="mt-1">{continueReading}</div>
                </motion.div>
              )}

              <motion.div
                custom={3}
                variants={rise}
                className="shrink-0 mt-[clamp(0.9rem,4vh,2.5rem)] grid grid-cols-4 gap-2 sm:gap-3"
              >
                {TIME_OPTIONS.map((option) => {
                  const fits = overview.fits[option.minutes];
                  return (
                    <button
                      key={option.minutes}
                      type="button"
                      onClick={() => startSession(option.minutes)}
                      className="group flex flex-col items-start min-w-0 rounded-xl sm:rounded-2xl bg-[var(--reader-surface)] ring-1 ring-[var(--reader-border)] px-3 sm:px-5 py-[clamp(0.6rem,1.8vh,1rem)] text-left transition-all duration-200 hover:-translate-y-0.5 hover:ring-[var(--pen)] hover:shadow-[0_14px_40px_-22px_rgba(0,0,0,0.45)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--pen)]"
                    >
                      <span className="flex items-baseline gap-0.5 sm:gap-1">
                        <span className="font-serif font-light leading-none tracking-tight text-[clamp(1.9rem,min(4.2vw,6vh),3.25rem)] transition-colors group-hover:text-[var(--pen)]">
                          {option.minutes}
                        </span>
                        <span className="font-serif text-[13px] sm:text-[17px] text-[var(--reader-muted)]">
                          {"plus" in option ? "+" : ""}
                          <span className="hidden sm:inline"> min</span>
                        </span>
                      </span>
                      <span className="hidden sm:block mt-[clamp(0.25rem,1.2vh,0.75rem)] text-[13.5px] text-[var(--reader-fg-soft)] truncate max-w-full">
                        {option.label}
                      </span>
                      <span className="mt-1 sm:mt-0 text-[11px] sm:text-[11.5px] text-[var(--reader-muted)]">
                        {fits === 0 ? "none" : `${fits} fit`}
                      </span>
                    </button>
                  );
                })}
              </motion.div>

              <motion.form
                custom={3.5}
                variants={rise}
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = new FormData(e.currentTarget)
                    .get("q")
                    ?.toString()
                    .trim();
                  router.push(
                    q ? `/library?q=${encodeURIComponent(q)}` : "/library",
                  );
                }}
                className="shrink-0 mt-3 flex items-center gap-2 h-10 rounded-full pl-4 pr-1 bg-[var(--reader-chip)] ring-1 ring-[var(--reader-border)] focus-within:ring-[var(--pen)] transition-shadow"
              >
                <MessagesSquare
                  size={14}
                  className="shrink-0 text-[var(--reader-muted)]"
                />
                <input
                  name="q"
                  placeholder="Or ask your library: something about science, that piece about cows…"
                  aria-label="Ask your library"
                  className="flex-1 min-w-0 bg-transparent text-[13.5px] outline-none placeholder:text-[var(--reader-muted)]"
                />
                <button
                  type="submit"
                  aria-label="Ask"
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-[var(--reader-fg)] text-[var(--reader-bg)]"
                >
                  <ArrowRight size={14} />
                </button>
              </motion.form>

              {overview.upNext.length > 0 && (
                <motion.section
                  custom={4}
                  variants={rise}
                  className="flex-1 min-h-0 flex flex-col mt-[clamp(1rem,4.5vh,3.5rem)]"
                >
                  <h2 className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--reader-muted)]">
                    Up next
                  </h2>
                  <FitChildren
                    label="Up next"
                    className="flex-1 mt-2.5 border-t border-[var(--reader-border)]"
                  >
                    {overview.upNext.map((article) => (
                      <Link
                        key={article._id}
                        href={`/read/${article._id}`}
                        className="group flex items-baseline gap-6 py-3 border-b border-[var(--reader-border)] outline-none focus-visible:bg-[var(--reader-chip)]"
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
                </motion.section>
              )}
            </motion.div>

            {/* Margin column: notes that don't fit the screen are left out */}
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
