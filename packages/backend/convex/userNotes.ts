import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { ownedArticleCard as ownedArticle, requireArticle } from "./access";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { nodeKey } from "./lib/ideaGraph";
import { importLibraryActive } from "./lib/importJobs";
import {
  NOTE_INDEX_DELAY_MS,
  NOTE_INDEX_LEASE_MS,
  NOTE_INDEX_MAX_ATTEMPTS,
  noteIndexFence,
  noteIndexInput,
} from "./lib/noteIndex";
import {
  assertBytes,
  NOTE_HTML_BYTES,
  NOTE_PLAIN_BYTES,
  notePreview,
  validateIndex,
  validateNote,
} from "./lib/readerBodies";

export const create = mutation({
  args: {
    articleId: v.id("articles"),
    selectedText: v.string(),
    selectedStartOffset: v.optional(v.number()),
    selectedEndOffset: v.optional(v.number()),
    unitIndex: v.optional(v.number()),
    annotationId: v.optional(v.id("annotations")),
    prompt: v.optional(v.string()),
    content: v.string(),
    contentPlain: v.string(),
  },
  handler: async (ctx, args) => {
    const article = await requireArticle(ctx, args.articleId, ctx.readerId);
    validateNote(args.content, args.contentPlain);
    assertBytes(args.selectedText, 32_000, "Selection");
    if (args.prompt) assertBytes(args.prompt, 16_000, "Prompt");
    validateIndex(args.unitIndex, "unit");
    let annotationId = args.annotationId;
    if (annotationId) {
      // The annotation may since have been replaced, but never another reader's
      const annotation = await ctx.db.get("annotations", annotationId);
      if (
        annotation &&
        (annotation.userId !== ctx.readerId ||
          annotation.articleId !== args.articleId ||
          annotation.unitIndex !== args.unitIndex)
      )
        throw new Error("Annotation not found");
      // Replaced while the reader was writing: keep the note as their own,
      // anchored by its passage, so it still sits beside its line
      if (!annotation) annotationId = undefined;
    }
    const now = Date.now();
    const noteId = await ctx.db.insert("userNotes", {
      userId: ctx.readerId,
      articleId: args.articleId,
      selectedText: args.selectedText,
      licensedQuote: article.bible?.displayVersionId ? true : undefined,
      selectedStartOffset: args.selectedStartOffset,
      selectedEndOffset: args.selectedEndOffset,
      unitIndex: args.unitIndex,
      annotationId,
      prompt: args.prompt,
      content: args.content,
      contentPlain: args.contentPlain,
      createdAt: now,
      updatedAt: now,
    });
    const note = await ctx.db.get(noteId);
    if (note) await queueNoteIndex(ctx, note);
    return noteId;
  },
});

export const update = mutation({
  args: {
    noteId: v.id("userNotes"),
    content: v.string(),
    contentPlain: v.string(),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get("userNotes", args.noteId);
    if (note?.userId !== ctx.readerId) throw new Error("Note not found");
    validateNote(args.content, args.contentPlain);
    const inputChanged =
      noteIndexInput(note) !== noteIndexInput({ ...note, ...args });
    const patch: Partial<Doc<"userNotes">> = {
      content: args.content,
      contentPlain: args.contentPlain,
      updatedAt: Date.now(),
    };
    if (inputChanged) {
      patch.embedding = undefined;
      patch.embeddedAt = Date.now();
    }
    await ctx.db.patch(args.noteId, patch);
    // Every save is acknowledged now; only optional indexing is debounced.
    const updated = await ctx.db.get(args.noteId);
    if (updated) await queueNoteIndex(ctx, updated);
  },
});

export const remove = mutation({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get("userNotes", args.noteId);
    if (note?.userId !== ctx.readerId) throw new Error("Note not found");
    await cancelIndexWake(ctx, note);
    await ctx.db.delete(args.noteId);
    // Its links go in small batches of their own, so a heavily linked note
    // can't push this delete over a transaction limit
    await ctx.scheduler.runAfter(0, internal.ideaLinks.sweep, {
      userId: ctx.readerId,
      key: nodeKey("note", args.noteId),
    });
  },
});

export const listByArticle = query({
  args: {
    articleId: v.id("articles"),
    // For a book: only the notes written in this part
    unitIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId))) return [];
    const unitIndex = args.unitIndex;
    return unitIndex === undefined
      ? ctx.db
          .query("userNotes")
          .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
          .order("desc")
          .collect()
      : ctx.db
          .query("userNotes")
          .withIndex("by_article_and_unitIndex", (q) =>
            q.eq("articleId", args.articleId).eq("unitIndex", unitIndex),
          )
          .order("desc")
          .collect();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("userNotes")
      .withIndex("by_user_recent", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .take(100);
  },
});

export const getById = query({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    return note?.userId === ctx.readerId ? note : null;
  },
});

/** Additive lean contract. Full HTML and vectors never enter a collection DTO.
 * Pagination bounds whole-document database reads, not just wire bytes. */
export const listPreviewsByArticle = query({
  args: {
    articleId: v.id("articles"),
    unitIndex: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (!(await ownedArticle(ctx, args.articleId, ctx.readerId)))
      return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("userNotes")
      .withIndex("by_article_and_unitIndex", (q) =>
        q.eq("articleId", args.articleId).eq("unitIndex", args.unitIndex),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(1, Math.min(25, args.paginationOpts.numItems)),
        maximumBytesRead: 2_000_000,
      });
    return {
      ...page,
      page: await Promise.all(
        page.page.filter((row) => row.userId === ctx.readerId).map(notePreview),
      ),
    };
  },
});

export const listPreviews = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("userNotes")
      .withIndex("by_user_recent", (q) => q.eq("userId", ctx.readerId))
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(1, Math.min(25, args.paginationOpts.numItems)),
        maximumBytesRead: 2_000_000,
      });
    return { ...page, page: await Promise.all(page.page.map(notePreview)) };
  },
});

export const getPreviewById = query({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.noteId);
    return row?.userId === ctx.readerId ? notePreview(row) : null;
  },
});

/** Old oversized notes are returned whole only here, on explicit open. Never
 * return truncated rich HTML that an editor could overwrite as a full note. */
export const getBody = query({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.noteId);
    if (row?.userId !== ctx.readerId) return null;
    return {
      _id: row._id,
      content: row.content,
      contentPlain: row.contentPlain,
      legacyOversized:
        new TextEncoder().encode(row.content).byteLength > NOTE_HTML_BYTES ||
        new TextEncoder().encode(row.contentPlain).byteLength >
          NOTE_PLAIN_BYTES,
    };
  },
});

// --- Internal ---

async function cancelIndexWake(ctx: MutationCtx, note: Doc<"userNotes">) {
  const id = note.noteIndex?.wakeId;
  if (!id) return;
  const wake = await ctx.db.system.get(id);
  if (wake?.state.kind === "pending") await ctx.scheduler.cancel(id);
}

async function activeNote(ctx: MutationCtx, note: Doc<"userNotes">) {
  if (!(await importLibraryActive(ctx, note.userId))) return false;
  return Boolean(await ownedArticle(ctx, note.articleId, note.userId));
}

/** A semantic edit/recovery replaces one wake, not the persisted draft. */
async function queueNoteIndex(
  ctx: MutationCtx,
  note: Doc<"userNotes">,
  retry = false,
) {
  const input = noteIndexInput(note);
  const old = note.noteIndex;
  if (!retry && old?.input === input) {
    if (old.status === "pending" || old.status === "running") {
      const wake = old.wakeId && (await ctx.db.system.get(old.wakeId));
      if (!wake || !["pending", "inProgress"].includes(wake.state.kind)) {
        // A disabled library can consume a wake. An explicit later catch-up or
        // save may restore it, without resetting revision/attempt/debounce.
        const at = old.status === "pending" ? old.dueAt : old.leaseUntil;
        const wakeId = await ctx.scheduler.runAfter(
          Math.max(0, (at ?? 0) - Date.now()),
          internal.userNotes.startIndex,
          { noteId: note._id, revision: old.revision },
        );
        await ctx.db.patch(note._id, { noteIndex: { ...old, wakeId } });
      }
    }
    return;
  }
  // Existing vectors need no paid migration, including HTML-only legacy edits.
  if (!retry && !old && note.embedding) return;
  await cancelIndexWake(ctx, note);
  const revision = (old?.revision ?? 0) + 1;
  const wakeId = input
    ? await ctx.scheduler.runAfter(
        NOTE_INDEX_DELAY_MS,
        internal.userNotes.startIndex,
        { noteId: note._id, revision },
      )
    : undefined;
  const patch: Partial<Doc<"userNotes">> = {
    noteIndex: {
      revision,
      input,
      status: input ? "pending" : "unavailable",
      attempt: 0,
      dueAt: input ? Date.now() + NOTE_INDEX_DELAY_MS : undefined,
      wakeId,
    },
  };
  if (note.embedding) {
    patch.embedding = undefined;
    patch.embeddedAt = Date.now();
  }
  await ctx.db.patch(note._id, patch);
}

/** Explicit recovery of a terminal failure; ordinary identical autosaves and
 * credential catch-up must not silently reset its paid-attempt budget. */
export const retryIndex = mutation({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (note?.userId !== ctx.readerId || !(await activeNote(ctx, note)))
      throw new Error("Note not found");
    if (
      note.noteIndex?.status === "failed" ||
      note.noteIndex?.status === "unavailable"
    )
      await queueNoteIndex(ctx, note, true);
  },
});

/** Compatibility entry for old queued {noteId} actions and credential catch-up.
 * Neither may bypass a pending debounce or reset a permanent/exhausted job. */
export const requestIndex = internalMutation({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note || !(await activeNote(ctx, note))) return;
    await queueNoteIndex(ctx, note, note.noteIndex?.status === "unavailable");
  },
});

/** Durable dispatch + recovery are committed together, even if an action dies
 * before its first RPC. Re-delivery is fenced by revision and attempt. */
export const startIndex = internalMutation({
  args: { noteId: v.id("userNotes"), revision: v.number() },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    const job = note?.noteIndex;
    if (
      !note ||
      !job ||
      job.revision !== args.revision ||
      !(await activeNote(ctx, note))
    )
      return;
    if (job.input !== noteIndexInput(note)) {
      await queueNoteIndex(ctx, note);
      return;
    }
    if (
      job.status !== "pending" &&
      !(job.status === "running" && (job.leaseUntil ?? 0) <= Date.now())
    )
      return;
    if (job.status === "pending" && (job.dueAt ?? 0) > Date.now()) return;
    await cancelIndexWake(ctx, note);
    if (job.attempt >= NOTE_INDEX_MAX_ATTEMPTS) {
      await ctx.db.patch(note._id, {
        noteIndex: {
          ...job,
          status: "failed",
          wakeId: undefined,
          leaseUntil: undefined,
        },
      });
      return;
    }
    const attempt = job.attempt + 1;
    const wakeId = await ctx.scheduler.runAfter(
      NOTE_INDEX_LEASE_MS,
      internal.userNotes.startIndex,
      args,
    );
    await ctx.db.patch(note._id, {
      noteIndex: {
        ...job,
        status: "running",
        attempt,
        leaseUntil: Date.now() + NOTE_INDEX_LEASE_MS,
        dispatched: false,
        wakeId,
      },
    });
    await ctx.scheduler.runAfter(0, internal.actions.embedUserNote.runClaimed, {
      noteId: note._id,
      userId: note.userId,
      revision: job.revision,
      attempt,
    });
  },
});

type IndexFence = {
  noteId: Id<"userNotes">;
  userId: string;
  revision: number;
  attempt: number;
};

async function currentIndexClaim(ctx: MutationCtx, args: IndexFence) {
  const note = await ctx.db.get(args.noteId);
  const job = note?.noteIndex;
  if (
    !note ||
    note.userId !== args.userId ||
    !job ||
    job.status !== "running" ||
    job.revision !== args.revision ||
    job.attempt !== args.attempt ||
    (job.leaseUntil ?? 0) <= Date.now() ||
    !(await activeNote(ctx, note))
  )
    return null;
  if (job.input !== noteIndexInput(note)) {
    await queueNoteIndex(ctx, note);
    return null;
  }
  return note;
}

/** Check before opening credentials, then again immediately before fetch.
 * Only the latter consumes dispatch permission, exactly once per claim. */
export const checkIndexClaim = internalMutation({
  args: { ...noteIndexFence, dispatch: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const note = await currentIndexClaim(ctx, args);
    const job = note?.noteIndex;
    if (!note || !job || job.dispatched) return null;
    if (args.dispatch)
      await ctx.db.patch(note._id, {
        noteIndex: { ...job, dispatched: true },
      });
    return job.input;
  },
});

export const failIndex = internalMutation({
  args: {
    ...noteIndexFence,
    status: v.union(v.literal("failed"), v.literal("unavailable")),
    dispatched: v.boolean(),
  },
  handler: async (ctx, args) => {
    const note = await currentIndexClaim(ctx, args);
    if (!note?.noteIndex || note.noteIndex.dispatched !== args.dispatched)
      return;
    await cancelIndexWake(ctx, note);
    await ctx.db.patch(note._id, {
      noteIndex: {
        ...note.noteIndex,
        status: args.status,
        wakeId: undefined,
        leaseUntil: undefined,
      },
    });
  },
});

export const listByArticleInternal = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) =>
    ctx.db
      .query("userNotes")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .order("desc")
      .take(500),
});

export const getByIdInternal = internalQuery({
  args: { noteId: v.id("userNotes") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.noteId);
  },
});

export const setEmbedding = internalMutation({
  args: {
    noteId: v.id("userNotes"),
    embedding: v.array(v.float64()),
    contentPlain: v.string(),
    // Old queued actions keep validating, but tokenless results cannot prove
    // selection/prompt identity. Requeue them through the safe protocol instead.
    userId: v.optional(v.string()),
    revision: v.optional(v.number()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (
      args.userId === undefined ||
      args.revision === undefined ||
      args.attempt === undefined
    ) {
      const note = await ctx.db.get(args.noteId);
      if (note && (await activeNote(ctx, note)))
        await queueNoteIndex(ctx, note);
      return;
    }
    const note = await currentIndexClaim(ctx, {
      noteId: args.noteId,
      userId: args.userId,
      revision: args.revision,
      attempt: args.attempt,
    });
    if (!note?.noteIndex?.dispatched) return;
    await cancelIndexWake(ctx, note);
    await ctx.db.patch(args.noteId, {
      embedding: args.embedding,
      embeddedAt: Date.now(),
      noteIndex: {
        ...note.noteIndex,
        status: "ready",
        wakeId: undefined,
        leaseUntil: undefined,
      },
    });
  },
});
