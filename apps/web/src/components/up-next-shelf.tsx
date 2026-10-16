"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Archive, Bookmark } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { toast } from "sonner";
import { useListKeys } from "@/lib/list-nav";

/**
 * Unread articles, newest first, as plain rows. Archiving lives here because
 * the desk no longer lists them; rung 4 restyles the shelves.
 */
export function UpNextShelf() {
  const reduced = useReducedMotion();
  const overview = useQuery(api.home.overview, {});
  const archiveArticle = useMutation(api.articles.archive);
  const restoreArticle = useMutation(api.articles.restore);
  const saved = useQuery(api.savedArticles.list);
  const saveArticle = useMutation(api.savedArticles.save);
  const unsaveArticle = useMutation(api.savedArticles.unsave);
  const savedIds = new Set(saved?.map((item) => item?.articleId));
  // `u` undoes the latest archive, the same as the toast's Undo button
  const lastArchived = useRef<Id<"articles"> | null>(null);

  const undo = (articleId: Id<"articles">) => {
    if (lastArchived.current === articleId) lastArchived.current = null;
    return restoreArticle({ articleId }).catch(() =>
      toast.error("Couldn't restore it. Find it in search instead."),
    );
  };
  const archive = async (articleId: Id<"articles">, title: string) => {
    try {
      await archiveArticle({ articleId });
    } catch {
      toast.error("Couldn't archive that article. Try again.");
      return;
    }
    lastArchived.current = articleId;
    toast(`Archived “${title}”`, {
      action: { label: "Undo", onClick: () => void undo(articleId) },
    });
  };
  const toggleSaved = (articleId: Id<"articles">) =>
    (savedIds.has(articleId)
      ? unsaveArticle({ articleId })
      : saveArticle({ articleId })
    ).catch(() => toast.error("Couldn't update saved articles. Try again."));

  useListKeys(
    {
      x: { action: "archive", leaves: true },
      s: { action: "save" },
      u: () => {
        if (!lastArchived.current) return false;
        void undo(lastArchived.current);
        return true;
      },
    },
    [
      ["x", "Archive"],
      ["u", "Undo the last archive"],
      ["s", "Save or unsave"],
    ],
  );

  if (!overview || overview.upNext.length === 0) return null;
  return (
    // The shelf tab above already names it, so no heading of its own
    <section aria-label="Up next" className="mt-6">
      <ul className="border-t border-[var(--reader-border)]">
        <AnimatePresence initial={false}>
          {overview.upNext.map((article) => (
            <motion.li
              key={article._id}
              layout={reduced ? false : "position"}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24, height: 0 }}
              transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
              data-nav-row
              className="group/row flex items-center overflow-hidden border-b border-[var(--reader-border)]"
            >
              <Link
                href={`/read/${article._id}`}
                data-nav-item
                className="group min-w-0 flex-1 py-3.5 pr-2 outline-none focus-visible:bg-[var(--reader-chip)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--reader-focus)]"
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
                onClick={() => void toggleSaved(article._id)}
                data-nav-action="save"
                aria-pressed={savedIds.has(article._id)}
                aria-label={`Save ${article.title} for later`}
                title="Save for later"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--reader-muted)] hover:text-[var(--ink)] focus-visible:text-[var(--ink)] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
              >
                <Bookmark
                  size={16}
                  fill={savedIds.has(article._id) ? "currentColor" : "none"}
                />
              </button>
              <button
                type="button"
                data-nav-action="archive"
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
