"use client";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@marginalia/backend/convex/_generated/api";
import { formatReadTime } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "sonner";
import Link from "next/link";

const TIME_OPTIONS = [
  { minutes: 5, label: "5 min", sublabel: "Quick read" },
  { minutes: 10, label: "10 min", sublabel: "Coffee break" },
  { minutes: 20, label: "20 min", sublabel: "Focused" },
  { minutes: 30, label: "30+", sublabel: "Deep dive" },
];

export default function HomePage() {
  const router = useRouter();
  const createSession = useMutation(api.sessions.create);
  const addByUrl = useAction(api.actions.addArticleByUrl.add);
  const savedCount = useQuery(api.savedArticles.count);
  const annotatedArticles = useQuery(api.articles.listAnnotated);
  const feeds = useQuery(api.feeds.list);
  const inProgress = useQuery(api.sessions.getInProgress);
  const dueForReview = useQuery(api.lovedArticles.getDueForReview);
  const advanceReview = useMutation(api.lovedArticles.advanceReview);
  const snoozeReview = useMutation(api.lovedArticles.snooze);

  const [articleUrl, setArticleUrl] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);

  const handleTimeSelect = async (minutes: number) => {
    const sessionId = await createSession({ requestedMinutes: minutes });
    router.push(`/session/${sessionId}`);
  };

  const handleAddUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!articleUrl.trim()) return;
    setAddingUrl(true);
    try {
      const { articleId, alreadyExists } = await addByUrl({
        url: articleUrl.trim(),
      });
      if (alreadyExists) {
        toast.info("Article already exists. Opening it.");
      } else {
        toast.success("Article added. Annotations generating...");
      }
      setArticleUrl("");
      router.push(`/read/${articleId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to fetch article",
      );
    }
    setAddingUrl(false);
  };

  const hasFeeds = feeds && feeds.length > 0;
  const hasArticles = annotatedArticles && annotatedArticles.length > 0;

  const urlInput = (
    <form onSubmit={handleAddUrl} className="w-full max-w-md mb-10">
      <p className="text-xs font-sans text-ink-400 dark:text-ink-500 mb-2 text-center">
        Or paste an article URL
      </p>
      <div className="flex gap-2">
        <input
          type="url"
          value={articleUrl}
          onChange={(e) => setArticleUrl(e.target.value)}
          placeholder="https://example.com/article"
          className="flex-1 px-4 py-2.5 rounded-xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 text-ink-800 dark:text-parchment-300 font-sans text-sm placeholder:text-ink-300 dark:placeholder:text-ink-600 focus:outline-none focus:border-annotation-crossref"
        />
        <button
          type="submit"
          disabled={addingUrl || !articleUrl.trim()}
          className="px-4 py-2.5 bg-ink-950 dark:bg-parchment-100 text-parchment-50 dark:text-ink-950 rounded-xl font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {addingUrl ? "..." : "Read"}
        </button>
      </div>
    </form>
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 py-12">
      {/* Theme toggle */}
      <div className="fixed top-4 right-4">
        <ThemeToggle />
      </div>

      {/* Header */}
      <div className="text-center mb-16">
        <h1 className="text-5xl font-serif font-light tracking-tight text-ink-950 dark:text-parchment-100 mb-3">
          Marginalia
        </h1>
        <p className="text-ink-500 dark:text-ink-400 font-sans text-sm tracking-wide uppercase">
          Read with context
        </p>
      </div>

      {!hasFeeds && !hasArticles ? (
        /* Empty state */
        <div className="flex flex-col items-center max-w-md">
          {urlInput}
          <div className="flex items-center gap-3 mb-6">
            <div className="h-px w-12 bg-ink-200 dark:bg-ink-700" />
            <span className="text-xs font-sans text-ink-300 dark:text-ink-600">
              or
            </span>
            <div className="h-px w-12 bg-ink-200 dark:bg-ink-700" />
          </div>
          <Link
            href="/feeds"
            className="text-annotation-crossref hover:underline font-sans text-sm"
          >
            Add RSS feeds for continuous reading
          </Link>
        </div>
      ) : !hasArticles ? (
        /* Feeds exist but no articles annotated yet */
        <div className="flex flex-col items-center max-w-md">
          {urlInput}
          <p className="text-ink-400 dark:text-ink-500 text-sm font-sans text-center mb-4">
            Feed articles are being processed in the background.
          </p>
          <Link
            href="/feeds"
            className="text-annotation-crossref hover:underline font-sans text-sm"
          >
            Manage feeds
          </Link>
        </div>
      ) : (
        /* Main flow: time picker */
        <>
          {/* Continue reading card */}
          {inProgress && (
            <Link
              href={`/read/${inProgress.article._id}`}
              className="w-full max-w-sm mb-10 p-5 rounded-xl border border-annotation-crossref/30 bg-annotation-crossref/5 dark:bg-annotation-crossref/10 hover:border-annotation-crossref transition-colors group block"
            >
              <p className="text-[10px] font-sans font-semibold text-annotation-crossref uppercase tracking-wider mb-2">
                Continue reading
              </p>
              <p className="text-base font-serif font-medium text-ink-900 dark:text-parchment-100 group-hover:text-annotation-crossref transition-colors line-clamp-2 mb-1">
                {inProgress.article.title}
              </p>
              <p className="text-xs font-sans text-ink-400 dark:text-ink-500">
                {inProgress.scrollPercent}% read
                {inProgress.remainingMinutes
                  ? ` · ~${inProgress.remainingMinutes} min left`
                  : ""}
              </p>
            </Link>
          )}

          {/* Revisit loved articles */}
          {dueForReview && dueForReview.length > 0 && (
            <div className="w-full max-w-sm mb-10">
              {dueForReview.map((item: any) => (
                <div
                  key={item._id}
                  className="p-5 rounded-xl border border-red-500/20 bg-red-500/5 dark:bg-red-500/10 mb-3"
                >
                  <p className="text-[10px] font-sans font-semibold text-red-500 uppercase tracking-wider mb-2">
                    Revisit
                  </p>
                  <p className="text-base font-serif font-medium text-ink-900 dark:text-parchment-100 line-clamp-2 mb-1">
                    {item.article.title}
                  </p>
                  <p className="text-xs font-sans text-ink-400 dark:text-ink-500 mb-3">
                    Last read {item.daysSinceLastRead} days ago
                  </p>
                  <div className="flex gap-2">
                    <Link
                      href={`/read/${item.articleId}`}
                      onClick={async () => {
                        await advanceReview({ articleId: item.articleId });
                      }}
                      className="px-4 py-1.5 bg-ink-950 dark:bg-parchment-100 text-parchment-50 dark:text-ink-950 rounded-lg text-xs font-sans font-medium hover:opacity-90 transition-opacity"
                    >
                      Read again
                    </Link>
                    <button
                      onClick={async () => {
                        await snoozeReview({ articleId: item.articleId });
                      }}
                      className="px-4 py-1.5 border border-ink-200 dark:border-ink-700 rounded-lg text-xs font-sans text-ink-500 hover:border-ink-400 transition-colors"
                    >
                      Not now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <h2 className="text-2xl font-serif text-ink-800 dark:text-parchment-200 mb-10">
            How much time do you have?
          </h2>

          <div className="grid grid-cols-2 gap-4 max-w-sm w-full mb-12">
            {TIME_OPTIONS.map((opt) => (
              <button
                key={opt.minutes}
                onClick={() => handleTimeSelect(opt.minutes)}
                className="group flex flex-col items-center justify-center p-6 rounded-xl border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 hover:border-annotation-crossref dark:hover:border-annotation-crossref transition-all duration-200 hover:shadow-lg hover:shadow-annotation-crossref/10"
              >
                <span className="text-2xl font-serif font-medium text-ink-950 dark:text-parchment-100 group-hover:text-annotation-crossref transition-colors">
                  {opt.label}
                </span>
                <span className="text-xs font-sans text-ink-400 dark:text-ink-500 mt-1">
                  {opt.sublabel}
                </span>
              </button>
            ))}
          </div>

          {/* Add article by URL */}
          {urlInput}

          {/* Bottom links */}
          <div className="flex gap-6 font-sans text-sm">
            {(savedCount ?? 0) > 0 && (
              <Link
                href="/saved"
                className="text-ink-500 hover:text-ink-800 dark:hover:text-parchment-300 transition-colors"
              >
                Saved articles ({savedCount})
              </Link>
            )}
            <Link
              href="/notes"
              className="text-ink-500 hover:text-ink-800 dark:hover:text-parchment-300 transition-colors"
            >
              Notes
            </Link>
            <Link
              href="/reading"
              className="text-ink-500 hover:text-ink-800 dark:hover:text-parchment-300 transition-colors"
            >
              This week
            </Link>
            <Link
              href="/feeds"
              className="text-ink-500 hover:text-ink-800 dark:hover:text-parchment-300 transition-colors"
            >
              Manage feeds
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
