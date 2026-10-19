/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ownerTest,
  ownerWithKey,
  runScheduled,
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { nodeKey } from "./lib/ideaGraph";
import { computeFingerprint } from "./lib/marginaliaFingerprint";
import {
  NOTE_INDEX_DELAY_MS,
  NOTE_INDEX_LEASE_MS,
  NOTE_INDEX_MAX_ATTEMPTS,
} from "./lib/noteIndex";
import * as router from "./lib/router";

const modules = import.meta.glob("./**/*.ts");
const vector = Array.from({ length: 1536 }, () => 0.5);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function providers() {
  const inputs: string[][] = [];
  const replies: (() => Promise<Response>)[] = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).endsWith("/embeddings"))
      return Response.json({ data: [] }); // Public credential validation.
    inputs.push(JSON.parse(String(init?.body)).input);
    const reply = replies.shift();
    return reply
      ? reply()
      : Response.json({ data: [{ index: 0, embedding: vector }] });
  });
  return { inputs, replies };
}

function article(ctx: MutationCtx, userId = "default_user") {
  return ctx.db.insert("articles", {
    userId,
    guid: "note-index-fixture",
    url: "https://example.com/note-index-fixture",
    title: "Synthetic source",
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    embedding: vector,
    createdAt: Date.now(),
  });
}

async function fixture(key = true) {
  const t = key ? await ownerWithKey(modules) : await ownerTest(modules);
  const articleId = await t.run((ctx) => article(ctx));
  const noteId = await t.mutation(api.userNotes.create, {
    articleId,
    selectedText: "A passage",
    prompt: "Why?",
    content: "<p>First</p>",
    contentPlain: "First",
  });
  const save = (text: string, html = `<p>${text}</p>`) =>
    t.mutation(api.userNotes.update, {
      noteId,
      content: html,
      contentPlain: text,
    });
  const note = () => t.run((ctx) => ctx.db.get(noteId));
  return { t, articleId, noteId, save, note };
}

function fence(note: Doc<"userNotes"> | null) {
  if (!note?.noteIndex) throw new Error("Missing fixture claim");
  return {
    noteId: note._id,
    userId: note.userId,
    revision: note.noteIndex.revision,
    attempt: note.noteIndex.attempt,
  };
}

/** Stop after claiming, leaving the queued action unrun for race fixtures. */
async function claim(f: Awaited<ReturnType<typeof fixture>>) {
  const current = await f.note();
  if (!current?.noteIndex) throw new Error("Missing fixture job");
  vi.setSystemTime(Math.max(Date.now(), current.noteIndex.dueAt ?? 0));
  await f.t.mutation(internal.userNotes.startIndex, {
    noteId: f.noteId,
    revision: current.noteIndex.revision,
  });
  return fence(await f.note());
}

describe("coalesced optional note indexing", () => {
  it("acknowledges three public saves immediately, then pays once for only the final canonical input", async () => {
    const mock = providers();
    const f = await fixture();
    expect(
      await f.t.query(api.userNotes.getBody, { noteId: f.noteId }),
    ).toMatchObject({
      contentPlain: "First",
    });
    vi.advanceTimersByTime(700);
    await f.save("Second");
    expect(
      await f.t.query(api.userNotes.getBody, { noteId: f.noteId }),
    ).toMatchObject({
      contentPlain: "Second",
    });
    vi.advanceTimersByTime(700);
    await f.save("Final");
    expect(
      await f.t.query(api.userNotes.getBody, { noteId: f.noteId }),
    ).toMatchObject({
      contentPlain: "Final",
    });
    vi.advanceTimersByTime(NOTE_INDEX_DELAY_MS - 1);
    await f.t.finishInProgressScheduledFunctions();
    expect(mock.inputs).toEqual([]);
    await runScheduled(f.t, { stepMs: 1 });
    expect(mock.inputs).toEqual([["A passage\n\nWhy?\n\nFinal"]]);
    expect(await f.note()).toMatchObject({
      contentPlain: "Final",
      embedding: vector,
      noteIndex: { revision: 3, status: "ready", attempt: 1 },
    });
  });

  it("rejects a held old completion after a new save, without erasing the final pending job", async () => {
    const mock = providers();
    const held = deferred<Response>();
    mock.replies.push(() => held.promise);
    const f = await fixture();
    const first = await claim(f);
    const entered = deferred<void>();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
      const reply = originalFetch(...args);
      entered.resolve();
      return reply;
    });
    const action = f.t.action(internal.actions.embedUserNote.runClaimed, first);
    await entered.promise;
    await f.save("Latest");
    held.resolve(Response.json({ data: [{ index: 0, embedding: vector }] }));
    await action;
    expect(await f.note()).toMatchObject({
      contentPlain: "Latest",
      noteIndex: { revision: 2, status: "pending", attempt: 0 },
    });
    expect((await f.note())?.embedding).toBeUndefined();
    await runScheduled(f.t);
    expect(mock.inputs).toEqual([
      ["A passage\n\nWhy?\n\nFirst"],
      ["A passage\n\nWhy?\n\nLatest"],
    ]);
    expect((await f.note())?.embedding).toEqual(vector);
  });

  it("retains one claim across HTML-only saves and preserves vector/fingerprint timestamps", async () => {
    const mock = providers();
    const f = await fixture();
    const first = await claim(f);
    await f.save("First", "<p><strong>First</strong></p>");
    expect(fence(await f.note())).toEqual(first);
    await runScheduled(f.t);
    const ready = await f.note();
    const before = await f.t.run((ctx) =>
      computeFingerprint(ctx, "default_user"),
    );
    vi.advanceTimersByTime(700);
    await f.save("First", "<p><em>First</em></p>");
    const after = await f.t.run((ctx) =>
      computeFingerprint(ctx, "default_user"),
    );
    expect(after.notesMax).toBeGreaterThan(before.notesMax);
    expect(after.embeddedMax).toBe(before.embeddedMax);
    expect((await f.note())?.embeddedAt).toBe(ready?.embeddedAt);
    expect((await f.note())?.embedding).toEqual(vector);
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(1);
  });

  it("fences A→B→A, duplicate delivery and out-of-order completion by revision, not plain text", async () => {
    const mock = providers();
    const f = await fixture();
    const first = await claim(f);
    await f.t.mutation(internal.userNotes.checkIndexClaim, {
      ...first,
      dispatch: true,
    });
    await f.save("Other");
    await f.save("First");
    await f.t.mutation(internal.userNotes.setEmbedding, {
      ...first,
      contentPlain: "First",
      embedding: [9],
    });
    expect((await f.note())?.embedding).toBeUndefined();
    const latest = await claim(f);
    await Promise.all([
      f.t.action(internal.actions.embedUserNote.runClaimed, latest),
      f.t.action(internal.actions.embedUserNote.runClaimed, latest),
    ]);
    await f.t.mutation(internal.userNotes.failIndex, {
      ...first,
      status: "failed",
      dispatched: true,
    });
    await f.t.mutation(internal.userNotes.setEmbedding, {
      ...first,
      contentPlain: "First",
      embedding: [9],
    });
    await runScheduled(f.t);
    expect(mock.inputs).toEqual([["A passage\n\nWhy?\n\nFirst"]]);
    expect(await f.note()).toMatchObject({
      embedding: vector,
      noteIndex: { status: "ready", revision: 3 },
    });
  });

  it.each([
    "prompt",
    "selectedText",
  ] as const)("detects changed %s with identical plain text before dispatch and publication", async (field) => {
    const mock = providers();
    const f = await fixture();
    const first = await claim(f);
    await f.t.run((ctx) => ctx.db.patch(f.noteId, { [field]: "New context" }));
    await f.t.action(internal.actions.embedUserNote.runClaimed, first);
    expect(mock.inputs).toHaveLength(0);
    expect((await f.note())?.noteIndex).toMatchObject({
      revision: 2,
      status: "pending",
    });
    const next = await claim(f);
    await f.t.mutation(internal.userNotes.checkIndexClaim, {
      ...next,
      dispatch: true,
    });
    await f.t.run((ctx) =>
      ctx.db.patch(f.noteId, { [field]: "Final context" }),
    );
    await f.t.mutation(internal.userNotes.setEmbedding, {
      ...next,
      contentPlain: "First",
      embedding: [9],
    });
    expect((await f.note())?.embedding).toBeUndefined();
    await runScheduled(f.t);
    const expected =
      field === "prompt"
        ? "A passage\n\nFinal context\n\nFirst"
        : "Final context\n\nWhy?\n\nFirst";
    expect(mock.inputs).toEqual([[expected]]);
  });

  it("checks again after credential preparation so a save before dispatch spends nothing on the old claim", async () => {
    const mock = providers();
    const f = await fixture();
    const first = await claim(f);
    const load = router.loadReaderAI;
    vi.spyOn(router, "loadReaderAI").mockImplementationOnce(async (...args) => {
      const target = await load(...args);
      await f.save("Saved before dispatch");
      return target;
    });
    await f.t.action(internal.actions.embedUserNote.runClaimed, first);
    expect(mock.inputs).toHaveLength(0);
    await runScheduled(f.t);
    expect(mock.inputs).toEqual([
      ["A passage\n\nWhy?\n\nSaved before dispatch"],
    ]);
  });

  it("does not let duplicate pre-dispatch credential failure erase work already dispatched by another delivery", async () => {
    providers();
    const f = await fixture();
    const first = await claim(f);
    await f.t.mutation(internal.userNotes.checkIndexClaim, {
      ...first,
      dispatch: true,
    });
    await f.t.mutation(internal.userNotes.failIndex, {
      ...first,
      status: "unavailable",
      dispatched: false,
    });
    await f.t.mutation(internal.userNotes.failIndex, {
      ...first,
      status: "failed",
      dispatched: false,
    });
    await f.t.mutation(internal.userNotes.setEmbedding, {
      ...first,
      contentPlain: "First",
      embedding: vector,
    });
    expect((await f.note())?.embedding).toEqual(vector);
    expect((await f.note())?.noteIndex?.status).toBe("ready");
  });

  it("keeps no-key notes readable and recovers through the public credential-save catch-up, without editing", async () => {
    const mock = providers();
    const f = await fixture(false);
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(0);
    expect(
      await f.t.query(api.userNotes.getBody, { noteId: f.noteId }),
    ).toMatchObject({ contentPlain: "First" });
    expect((await f.note())?.noteIndex?.status).toBe("unavailable");
    await f.t.action(api.providerCredentials.save, {
      provider: "openrouter",
      apiKey: "sk-or-synthetic-note-key-0001",
    });
    await runScheduled(f.t);
    expect(mock.inputs).toEqual([["A passage\n\nWhy?\n\nFirst"]]);
    expect((await f.note())?.noteIndex?.status).toBe("ready");
  });

  it("accepts old noteId jobs and tokenless setters but never bypasses debounce or trusts plain-text identity", async () => {
    const mock = providers();
    const f = await fixture();
    await f.t.action(internal.actions.embedUserNote.embed, {
      noteId: f.noteId,
    });
    await f.t.action(internal.actions.embedUserNote.embed, {
      noteId: f.noteId,
    });
    await f.t.mutation(internal.userNotes.setEmbedding, {
      noteId: f.noteId,
      contentPlain: "First",
      embedding: [9],
    });
    expect(mock.inputs).toHaveLength(0);
    expect((await f.note())?.embedding).toBeUndefined();
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(1);
    await f.t.action(internal.actions.embedUserNote.embed, {
      noteId: f.noteId,
    });
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(1);
  });

  it("does not backfill existing vectors on HTML-only legacy edits; empty notes do no provider work", async () => {
    const mock = providers();
    const f = await fixture();
    await runScheduled(f.t);
    await f.t.run((ctx) => ctx.db.patch(f.noteId, { noteIndex: undefined }));
    const stamp = (await f.note())?.embeddedAt;
    await f.save("First", "<strong>First</strong>");
    await runScheduled(f.t);
    expect((await f.note())?.embeddedAt).toBe(stamp);
    expect(mock.inputs).toHaveLength(1);
    await f.save("");
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(1);
    expect((await f.note())?.embedding).toBeUndefined();
    expect((await f.note())?.noteIndex?.status).toBe("unavailable");
  });

  it("preserves the deployed bounded canonical input, so irrelevant suffix/HTML edits do not buy another vector", async () => {
    const mock = providers();
    const f = await fixture();
    await f.save("x".repeat(8100));
    await runScheduled(f.t);
    expect(mock.inputs).toEqual([[`A passage\n\nWhy?\n\n${"x".repeat(7983)}`]]);
    await f.save(`${"x".repeat(8100)} different suffix`);
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(1);
    expect((await f.note())?.embedding).toEqual(vector);
  });
});

describe("note indexing failure, lease and privacy fences", () => {
  it("makes provider failures terminal until explicit reader recovery, not an automatic paid retry", async () => {
    const mock = providers();
    mock.replies.push(async () =>
      Response.json({ error: "synthetic rejection" }, { status: 503 }),
    );
    const f = await fixture();
    await runScheduled(f.t);
    expect((await f.note())?.noteIndex).toMatchObject({
      status: "failed",
      attempt: 1,
    });
    await f.save("First", "<strong>First</strong>");
    await f.t.action(internal.actions.embedUserNote.embed, {
      noteId: f.noteId,
    });
    await f.t.mutation(internal.catchUp.start, { userId: "default_user" });
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(1);
    await f.t.mutation(api.userNotes.retryIndex, { noteId: f.noteId });
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(2);
    expect((await f.note())?.noteIndex?.status).toBe("ready");
  });

  it("recovers lost action leases, fences old claims and caps repeated lost work", async () => {
    const mock = providers();
    const f = await fixture();
    const old = await claim(f);
    for (let attempt = 1; attempt <= NOTE_INDEX_MAX_ATTEMPTS; attempt++) {
      // No timers run: simulate a worker lost before starting its scheduled action.
      vi.setSystemTime(Date.now() + NOTE_INDEX_LEASE_MS);
      await f.t.mutation(internal.userNotes.startIndex, {
        noteId: f.noteId,
        revision: old.revision,
      });
    }
    expect((await f.note())?.noteIndex).toMatchObject({
      status: "failed",
      attempt: NOTE_INDEX_MAX_ATTEMPTS,
    });
    await f.t.action(internal.actions.embedUserNote.runClaimed, old);
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(0);
    await f.t.mutation(api.userNotes.retryIndex, { noteId: f.noteId });
    const recovery = await claim(f);
    expect(recovery.revision).toBeGreaterThan(old.revision);
    await f.t.action(internal.actions.embedUserNote.runClaimed, recovery);
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(1);
    expect((await f.note())?.noteIndex?.status).toBe("ready");
  });

  it("recovers one genuinely lost action at lease expiry, never early, and rejects the expired result", async () => {
    const mock = providers();
    const f = await fixture();
    const old = await claim(f);
    await f.t.mutation(internal.userNotes.checkIndexClaim, {
      ...old,
      dispatch: true,
    });
    vi.setSystemTime(Date.now() + NOTE_INDEX_LEASE_MS - 1);
    await f.t.mutation(internal.userNotes.startIndex, {
      noteId: f.noteId,
      revision: old.revision,
    });
    expect(fence(await f.note())).toEqual(old);
    vi.setSystemTime(Date.now() + 1);
    await f.t.mutation(internal.userNotes.startIndex, {
      noteId: f.noteId,
      revision: old.revision,
    });
    const next = fence(await f.note());
    expect(next.attempt).toBe(2);
    await f.t.mutation(internal.userNotes.setEmbedding, {
      ...old,
      contentPlain: "First",
      embedding: [9],
    });
    expect((await f.note())?.embedding).toBeUndefined();
    await f.t.action(internal.actions.embedUserNote.runClaimed, next);
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(1);
    expect((await f.note())?.embedding).toEqual(vector);
  });

  it.each([
    "note",
    "article",
    "article-owner",
    "note-owner",
  ] as const)("does no work after %s removal/ownership change before dispatch or publication", async (kind) => {
    const mock = providers();
    const f = await fixture();
    const first = await claim(f);
    const publicationId = await f.t.mutation(api.userNotes.create, {
      articleId: f.articleId,
      selectedText: "Publication passage",
      content: "<p>Already dispatched</p>",
      contentPlain: "Already dispatched",
    });
    vi.setSystemTime(Date.now() + NOTE_INDEX_DELAY_MS);
    await f.t.mutation(internal.userNotes.startIndex, {
      noteId: publicationId,
      revision: 1,
    });
    const publication = fence(
      await f.t.run((ctx) => ctx.db.get(publicationId)),
    );
    await f.t.mutation(internal.userNotes.checkIndexClaim, {
      ...publication,
      dispatch: true,
    });
    const remove = () =>
      f.t.run(async (ctx) => {
        if (kind === "note") {
          await ctx.db.delete(f.noteId);
          await ctx.db.delete(publicationId);
        } else if (kind === "note-owner") {
          await ctx.db.patch(f.noteId, { userId: "someone-else" });
          await ctx.db.patch(publicationId, { userId: "someone-else" });
        } else if (kind === "article") await ctx.db.delete(f.articleId);
        else await ctx.db.patch(f.articleId, { userId: "someone-else" });
      });
    await remove();
    await f.t.action(internal.actions.embedUserNote.runClaimed, first);
    await f.t.mutation(internal.userNotes.setEmbedding, {
      ...publication,
      contentPlain: "Already dispatched",
      embedding: [9],
    });
    await runScheduled(f.t);
    expect(mock.inputs).toHaveLength(0);
    expect((await f.note())?.embedding).toBeUndefined();
    expect(
      (await f.t.run((ctx) => ctx.db.get(publicationId)))?.embedding,
    ).toBeUndefined();
  });

  it.each([
    "disabled",
    "deleting",
    "deleted",
  ] as const)("checks %s libraries before both provider dispatch and publication", async (state) => {
    const mock = providers();
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await saveTestCredential(
      t,
      readerLibraryId,
      "openrouter",
      "synthetic-reader-key",
    );
    const articleId = await t.run((ctx) => article(ctx, readerLibraryId));
    const noteId = await reader.mutation(api.userNotes.create, {
      articleId,
      selectedText: "Passage",
      content: "<p>Private fixture</p>",
      contentPlain: "Private fixture",
    });
    vi.setSystemTime(Date.now() + NOTE_INDEX_DELAY_MS);
    await t.mutation(internal.userNotes.startIndex, { noteId, revision: 1 });
    const first = fence(await t.run((ctx) => ctx.db.get(noteId)));
    const publicationId = await reader.mutation(api.userNotes.create, {
      articleId,
      selectedText: "Publication passage",
      content: "<p>Already dispatched</p>",
      contentPlain: "Already dispatched",
    });
    vi.setSystemTime(Date.now() + NOTE_INDEX_DELAY_MS);
    await t.mutation(internal.userNotes.startIndex, {
      noteId: publicationId,
      revision: 1,
    });
    const publication = fence(await t.run((ctx) => ctx.db.get(publicationId)));
    await t.mutation(internal.userNotes.checkIndexClaim, {
      ...publication,
      dispatch: true,
    });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
        .unique();
      if (!row) throw new Error("Missing fixture reader");
      if (state === "deleted") await ctx.db.delete(row._id);
      else
        await ctx.db.patch(
          row._id,
          state === "disabled"
            ? { status: "disabled" }
            : { deletingAt: Date.now() },
        );
    });
    await t.action(internal.actions.embedUserNote.runClaimed, first);
    await t.mutation(internal.userNotes.setEmbedding, {
      ...publication,
      contentPlain: "Already dispatched",
      embedding: [9],
    });
    await runScheduled(t);
    expect(mock.inputs).toHaveLength(0);
    expect(
      (await t.run((ctx) => ctx.db.get(noteId)))?.embedding,
    ).toBeUndefined();
    expect(
      (await t.run((ctx) => ctx.db.get(publicationId)))?.embedding,
    ).toBeUndefined();
  });

  it("restores a wake consumed while disabled without resetting revision or attempt budget", async () => {
    const mock = providers();
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await saveTestCredential(
      t,
      readerLibraryId,
      "openrouter",
      "synthetic-reactivated-key",
    );
    const articleId = await t.run((ctx) => article(ctx, readerLibraryId));
    const noteId = await reader.mutation(api.userNotes.create, {
      articleId,
      selectedText: "Passage",
      content: "<p>Saved before disabling</p>",
      contentPlain: "Saved before disabling",
    });
    const readerRow = await t.run((ctx) =>
      ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
        .unique(),
    );
    if (!readerRow) throw new Error("Missing fixture reader");
    await t.run((ctx) => ctx.db.patch(readerRow._id, { status: "disabled" }));
    await runScheduled(t);
    expect(mock.inputs).toHaveLength(0);
    await t.run((ctx) => ctx.db.patch(readerRow._id, { status: "active" }));
    await t.action(internal.actions.embedUserNote.embed, { noteId });
    await runScheduled(t);
    expect(mock.inputs).toEqual([["Passage\n\nSaved before disabling"]]);
    expect(await t.run((ctx) => ctx.db.get(noteId))).toMatchObject({
      embedding: vector,
      noteIndex: { revision: 1, attempt: 1, status: "ready" },
    });
  });

  it("denies cross-reader saves/recovery and catches up only the reader with a newly saved key", async () => {
    const mock = providers();
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    const ownerArticle = await t.run((ctx) => article(ctx));
    const readerArticle = await t.run((ctx) => article(ctx, readerLibraryId));
    const ownerNote = await owner.mutation(api.userNotes.create, {
      articleId: ownerArticle,
      selectedText: "Owner passage",
      content: "<p>Owner thought</p>",
      contentPlain: "Owner thought",
    });
    const readerNote = await reader.mutation(api.userNotes.create, {
      articleId: readerArticle,
      selectedText: "Reader passage",
      content: "<p>Reader thought</p>",
      contentPlain: "Reader thought",
    });
    await expect(
      reader.mutation(api.userNotes.update, {
        noteId: ownerNote,
        content: "stolen",
        contentPlain: "stolen",
      }),
    ).rejects.toThrow("Note not found");
    await expect(
      reader.mutation(api.userNotes.retryIndex, { noteId: ownerNote }),
    ).rejects.toThrow("Note not found");
    await expect(
      reader.mutation(api.userNotes.remove, { noteId: ownerNote }),
    ).rejects.toThrow("Note not found");
    expect(
      await reader.query(api.userNotes.getBody, { noteId: ownerNote }),
    ).toBeNull();
    await runScheduled(t);
    await reader.action(api.providerCredentials.save, {
      provider: "openrouter",
      apiKey: "sk-or-isolated-reader-fixture-0001",
    });
    await runScheduled(t);
    expect(mock.inputs).toEqual([["Reader passage\n\nReader thought"]]);
    expect(
      (await t.run((ctx) => ctx.db.get(ownerNote)))?.embedding,
    ).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(readerNote)))?.embedding).toEqual(
      vector,
    );
  });

  it("keeps readers isolated, rejects stolen claim identity, and retains bounded graph-link deletion", async () => {
    const mock = providers();
    const f = await fixture();
    const first = await claim(f);
    await f.t.action(internal.actions.embedUserNote.runClaimed, {
      ...first,
      userId: "another-library",
    });
    expect(mock.inputs).toHaveLength(0);
    await f.t.run((ctx) =>
      ctx.db.insert("ideaLinks", {
        userId: "default_user",
        from: nodeKey("note", f.noteId),
        to: "highlight:synthetic-fixture",
        createdAt: Date.now(),
      }),
    );
    await f.t.mutation(api.userNotes.remove, { noteId: f.noteId });
    await runScheduled(f.t);
    expect(await f.note()).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.query("ideaLinks").take(10))).toEqual(
      [],
    );
  });
});
