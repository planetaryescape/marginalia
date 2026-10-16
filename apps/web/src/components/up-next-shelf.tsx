"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Archive } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

/**
 * Unread articles, newest first, as plain rows. Archiving lives here because
 * the desk no longer lists them; rung 4 restyles the shelves.
 */
export function UpNextShelf() {
  const reduced = useReducedMotion();
  const overview = useQuery(api.home.overview, {});
  const archiveArticle = useMutation(api.articles.archive);
  const restoreArticle = useMutation(api.articles.restore);

  const archive = async (articleId: Id<"articles">, title: string) => {
    try {
      await archiveArticle({ articleId });
    } catch {
      toast.error("Couldn't archive that article. Try again.");
      return;
    }
    toast(`Archived “${title}”`, {
      action: {
        label: "Undo",
        onClick: () =>
          void restoreArticle({ articleId }).catch(() =>
            toast.error("Couldn't restore it. Find it in search instead."),
          ),
      },
    });
  };

  if (!overview || overview.upNext.length === 0) return null;
  return (
    <section aria-label="Up next" className="mt-14">
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--reader-muted)]">
        Up next
      </h2>
      <ul className="mt-3 border-t border-[var(--reader-border)]">
        <AnimatePresence initial={false}>
          {overview.upNext.map((article) => (
            <motion.li
              key={article._id}
              layout={reduced ? false : "position"}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24, height: 0 }}
              transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
              className="group/row flex items-center overflow-hidden border-b border-[var(--reader-border)]"
            >
              <Link
                href={`/read/${article._id}`}
                className="group min-w-0 flex-1 py-3.5 pr-2 outline-none focus-visible:bg-[var(--reader-chip)]"
              >
                <span className="block truncate font-serif text-[17px] sm:text-[18px] leading-snug group-hover:underline group-hover:decoration-[var(--pencil-rule)] underline-offset-4">
                  {article.title}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-[var(--reader-muted)]">
                  {[
                    article.source,
                    article.minutes ? `${article.minutes} min` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
              {/* Shown on hover and keyboard focus where there is a pointer, always on touch */}
              <button
                type="button"
                onClick={() => void archive(article._id, article.title)}
                aria-label={`Archive ${article.title}`}
                title="Archive"
                className="ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--reader-muted)] hover:text-[var(--ink)] focus-visible:text-[var(--ink)] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
              >
                <Archive size={16} />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
