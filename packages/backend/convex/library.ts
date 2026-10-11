import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { DEFAULT_USER_ID } from "./lib/constants";

// Data access for the "Ask your library" endpoint (lib/library.ts)

export const recentActivity = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [impressions, interactions] = await Promise.all([
      ctx.db
        .query("impressions")
        .withIndex("by_user_updated", (q) => q.eq("userId", DEFAULT_USER_ID))
        .order("desc")
        .take(60),
      ctx.db
        .query("articleInteractions")
        .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
        .order("desc")
        .take(1000),
    ]);
    return { impressions, interactions };
  },
});

export const loadMatches = internalQuery({
  args: {
    impressionIds: v.array(v.id("impressions")),
    noteIds: v.array(v.id("userNotes")),
    highlightIds: v.array(v.id("highlights")),
    threadIds: v.array(v.id("companionThreads")),
  },
  handler: async (ctx, args) => {
    const present = <T>(rows: (T | null)[]) =>
      rows.filter((row): row is T => row !== null);
    const [impressions, notes, highlights, threads] = await Promise.all([
      Promise.all(
        args.impressionIds.map((id) => ctx.db.get("impressions", id)),
      ),
      Promise.all(args.noteIds.map((id) => ctx.db.get("userNotes", id))),
      Promise.all(args.highlightIds.map((id) => ctx.db.get("highlights", id))),
      Promise.all(
        args.threadIds.map((id) => ctx.db.get("companionThreads", id)),
      ),
    ]);
    return {
      impressions: present(impressions),
      notes: present(notes),
      highlights: present(highlights),
      threads: present(threads),
    };
  },
});

export const loadArticles = internalQuery({
  args: { articleIds: v.array(v.id("articles")) },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.articleIds.map((id) => ctx.db.get("articles", id)),
    );
    // Only what the librarian needs; article bodies stay out of the prompt
    return rows.map((row) =>
      row
        ? {
            ...row,
            content: undefined,
            contentHtml: undefined,
            embedding: undefined,
          }
        : null,
    );
  },
});
