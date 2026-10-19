/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { metadataContext } from "../test/metadata";
import { addReader } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import authSchema from "./betterAuth/schema";
import {
  purgeFingerprintMetadata,
  sourceStamp,
} from "./lib/fingerprintMetadata";
import {
  computeFingerprint,
  computeLegacyFingerprint,
  sameFingerprint,
} from "./lib/marginaliaFingerprint";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const vector = Array.from({ length: 1536 }, () => 0.1);
const article = (userId = OWNER, content = "A sentence. ".repeat(3000)) => ({
  userId,
  guid: "fixture",
  url: "https://example.com/fixture",
  title: "Synthetic fixture",
  content,
  extractionStatus: "extracted" as const,
  annotationStatus: "annotated" as const,
  createdAt: 1,
});
function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  return t;
}
type Test = ReturnType<typeof fixture>;
async function migrate(t: Test, userId = OWNER) {
  for (let i = 0; i < 100; i++) {
    const result = await t.run((ctx) =>
      ctx.runMutation(
        internal.fingerprintMetadata.backfill,
        { userId },
        {
          transactionLimits: {
            bytesRead: 2 * 1024 * 1024,
            bytesWritten: 128 * 1024,
          },
        },
      ),
    );
    if (result.complete) return;
  }
  throw new Error("Synthetic migration did not finish");
}
async function equal(t: Test, userId = OWNER) {
  const old = await t.run((ctx) => computeLegacyFingerprint(ctx, userId, 123));
  const current = await t.run((ctx) => computeFingerprint(ctx, userId, 123));
  expect(current).toEqual(old);
  return current;
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("keeps ready checks below 128 KiB and the unchanged public gate below 1.25 MiB with near-limit bodies and 260 vectors", async () => {
  vi.useFakeTimers();
  const t = fixture();
  const { client, libraryId } = await addReader(t, {
    email: "small-gate@example.com",
  });
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      ...article(libraryId, "A sentence. ".repeat(75_000)),
      embeddedAt: 4,
    }),
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("userNotes", {
      userId: libraryId,
      articleId,
      selectedText: "A sentence.",
      content: "x".repeat(450_000),
      contentPlain: "y".repeat(450_000),
      embedding: vector,
      embeddedAt: 7,
      createdAt: 1,
      updatedAt: 10,
    });
    await ctx.db.insert("companionThreads", {
      userId: libraryId,
      articleId,
      mode: "ask",
      selection: "A sentence.",
      turns: [{ role: "assistant", content: "x".repeat(900_000) }],
      embedding: vector,
      embeddedAt: 8,
      createdAt: 1,
      updatedAt: 11,
    });
    await ctx.db.insert("noteChunks", {
      userId: libraryId,
      filePath: "synthetic.md",
      fileName: "Synthetic",
      chunkIndex: 0,
      content: "x".repeat(900_000),
      embedding: vector,
      fileHash: "fixture",
      indexedAt: 12,
    });
  });
  for (let start = 0; start < 260; start += 20)
    await t.run(async (ctx) => {
      for (let i = start; i < start + 20; i++)
        await ctx.db.insert("highlights", {
          userId: libraryId,
          articleId,
          kind: "highlight",
          text: `Mark ${i}`,
          embedding: vector,
          embeddedAt: 6,
          createdAt: i,
        });
    });
  const old = await t.run((ctx) => computeFingerprint(ctx, libraryId, 123));
  expect(old).toMatchObject({
    notesMax: 10,
    threadsMax: 11,
    highlightsCount: 250,
    vaultIndexedMax: 12,
    embeddedMax: 8,
  });
  await t.run((ctx) => ctx.db.patch(articleId, { marginaliaFingerprint: old }));
  await t.run((ctx) =>
    ctx.db.insert("marginaliaPasses", {
      userId: libraryId,
      articleId,
      sectionIndex: 1,
      status: "done",
      claim: 1,
      calls: 1,
      notesAdded: 0,
      fingerprint: old,
      contextHash: "already-considered",
      updatedAt: 1,
    }),
  );
  // A projection-after-read implementation demonstrably exceeds this physical
  // limit, unlike the metadata-only path below.
  await expect(
    t.run((ctx) =>
      ctx.runQuery(
        internal.alongside.currentFingerprint,
        { userId: libraryId },
        { transactionLimits: { bytesRead: 128 * 1024 } },
      ),
    ),
  ).rejects.toThrow(/bytes|read/i);
  await migrate(t, libraryId);
  const current = await t.run((ctx) =>
    ctx.runQuery(
      internal.alongside.currentFingerprint,
      { userId: libraryId },
      { transactionLimits: { bytesRead: 128 * 1024 } },
    ),
  );
  expect(sameFingerprint(old, current)).toBe(true);
  expect(await equal(t, libraryId)).toEqual(old);
  expect(
    await client.run((ctx) =>
      ctx.runMutation(
        api.alongside.requestAhead,
        { articleId, currentSection: 0 },
        { transactionLimits: { bytesRead: 1280 * 1024 } },
      ),
    ),
  ).toBe("unchanged");
  expect(
    await t.run((ctx) => ctx.db.query("marginaliaPasses").collect()),
  ).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("readerLimits").collect())).toEqual(
    [],
  );
  expect(
    await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toEqual([]);
});

it("preserves every legacy stamp under generic set, CLEAR, replace, transfer and delete without revision churn", async () => {
  const t = fixture();
  const { libraryId } = await addReader(t, { email: "transfer@example.com" });
  const ids = await t.run(async (raw) => {
    const ctx = metadataContext(raw);
    const a = await ctx.db.insert("articles", { ...article(), embeddedAt: 1 });
    const n = await ctx.db.insert("userNotes", {
      userId: OWNER,
      articleId: a,
      selectedText: "x",
      content: "x",
      contentPlain: "x",
      createdAt: 1,
      updatedAt: 2,
    });
    const h = await ctx.db.insert("highlights", {
      userId: OWNER,
      articleId: a,
      kind: "highlight",
      text: "x",
      createdAt: 1,
    });
    const c = await ctx.db.insert("companionThreads", {
      userId: OWNER,
      articleId: a,
      mode: "ask",
      selection: "x",
      turns: [],
      createdAt: 1,
      updatedAt: 3,
    });
    const v = await ctx.db.insert("noteChunks", {
      userId: OWNER,
      filePath: "x.md",
      fileName: "X",
      content: "x",
      embedding: vector,
      fileHash: "x",
      indexedAt: 4,
      chunkIndex: 0,
    });
    return { a, n, h, c, v };
  });
  await migrate(t);
  await migrate(t, libraryId);
  await equal(t);
  for (const id of [ids.a, ids.n, ids.h, ids.c]) {
    await t.run((raw) =>
      metadataContext(raw).db.patch(id, { embedding: vector, embeddedAt: 100 }),
    );
    expect((await equal(t)).embeddedMax).toBe(100);
    await t.run((raw) =>
      metadataContext(raw).db.patch(id, {
        embedding: undefined,
        embeddedAt: 101,
      }),
    );
    expect((await equal(t)).embeddedMax).toBe(101);
    await t.run(async (raw) => {
      const ctx = metadataContext(raw);
      const row = await ctx.db.get(id);
      if (!row) throw new Error("Missing source");
      const { _id, _creationTime, embeddedAt, embedding, ...fields } = row;
      await ctx.db.replace(_id, fields);
    });
    expect((await equal(t)).embeddedMax).toBe(0);
  }
  await t.run((raw) =>
    metadataContext(raw).db.patch(ids.n, { updatedAt: 200 }),
  );
  expect((await equal(t)).notesMax).toBe(200);
  await t.run((raw) =>
    metadataContext(raw).db.patch(ids.c, { updatedAt: 201 }),
  );
  expect((await equal(t)).threadsMax).toBe(201);
  await t.run((raw) =>
    metadataContext(raw).db.patch(ids.v, { indexedAt: 202 }),
  );
  expect((await equal(t)).vaultIndexedMax).toBe(202);
  const stamps = await t.run((ctx) =>
    ctx.db.query("marginaliaSourceStamps").collect(),
  );
  const mutate = (fn: (ctx: MutationCtx) => Promise<void>) =>
    t.run((raw) => fn(metadataContext(raw)));
  await mutate((ctx) =>
    ctx.db.patch(ids.n, {
      noteIndex: { revision: 1, input: "x", attempt: 1, status: "failed" },
    }),
  );
  await mutate((ctx) => ctx.db.patch(ids.h, { color: "yellow" }));
  await mutate((ctx) => ctx.db.patch(ids.a, { annotationRetries: 2 }));
  expect(
    await t.run((ctx) => ctx.db.query("marginaliaSourceStamps").collect()),
  ).toEqual(stamps);
  for (const id of Object.values(ids)) {
    // A generic replacement omits embedding/optional stamps exactly as the
    // old indexes do, and transfers only this source's legacy ownership.
    await t.run(async (raw) => {
      const ctx = metadataContext(raw);
      const row = await ctx.db.get(id);
      if (!row) throw new Error("Missing source");
      const { _id, _creationTime, ...fields } = row;
      await ctx.db.replace(_id, { ...fields, userId: libraryId });
    });
    await equal(t);
    await equal(t, libraryId);
  }
  for (const id of Object.values(ids)) {
    await mutate((ctx) => ctx.db.delete(id));
    await equal(t, libraryId);
  }
  expect(
    await t.run((ctx) => ctx.db.query("marginaliaSourceStamps").collect()),
  ).toEqual([]);
});

it("keeps the 250 count saturation and original source creation time", async () => {
  const t = fixture();
  const articleId = await t.run((raw) =>
    metadataContext(raw).db.insert("articles", article()),
  );
  const ids: Id<"highlights">[] = [];
  for (let i = 0; i < 252; i++)
    ids.push(
      await t.run((raw) =>
        metadataContext(raw).db.insert("highlights", {
          userId: OWNER,
          articleId,
          kind: "highlight",
          text: "x",
          createdAt: 999_999 - i,
        }),
      ),
    );
  await migrate(t);
  const capped = await equal(t);
  const newest = await t.run((ctx) => ctx.db.get(ids[251]));
  expect(capped).toMatchObject({
    highlightsCount: 250,
    highlightsMax: newest?._creationTime,
  });
  await t.run((raw) => metadataContext(raw).db.delete(ids[0]));
  expect(await equal(t)).toEqual(capped);
  await t.run((raw) => metadataContext(raw).db.delete(ids[1]));
  expect(await equal(t)).toEqual(capped);
  await t.run((raw) => metadataContext(raw).db.delete(ids[2]));
  expect((await equal(t)).highlightsCount).toBe(249);
});

it("is resumable and additive across migration interleavings; never seeds a partial baseline", async () => {
  const t = fixture();
  const articleId = await t.run((ctx) => ctx.db.insert("articles", article()));
  const ids: Id<"userNotes">[] = [];
  for (let i = 0; i < 40; i++)
    ids.push(
      await t.run((ctx) =>
        ctx.db.insert("userNotes", {
          userId: OWNER,
          articleId,
          selectedText: "x",
          content: "x",
          contentPlain: "x",
          createdAt: i,
          updatedAt: i,
        }),
      ),
    );
  await t.mutation(internal.fingerprintMetadata.backfill, { userId: OWNER });
  await t.mutation(internal.fingerprintMetadata.backfill, { userId: OWNER });
  expect(
    (await t.query(internal.fingerprintMetadata.status, { userId: OWNER }))
      .ready,
  ).toBe(false);
  await equal(t);
  await t.run(async (raw) => {
    const ctx = metadataContext(raw);
    await ctx.db.delete(ids[0]);
    await ctx.db.patch(ids[39], { updatedAt: 99 });
    await ctx.db.insert("userNotes", {
      userId: OWNER,
      articleId,
      selectedText: "x",
      content: "x",
      contentPlain: "x",
      createdAt: 0,
      updatedAt: 99,
    });
  });
  await equal(t);
  await migrate(t);
  expect((await equal(t)).notesMax).toBe(99);
  const before = await t.run((ctx) =>
    ctx.db.query("marginaliaSourceStamps").collect(),
  );
  await migrate(t);
  expect(
    await t.run((ctx) => ctx.db.query("marginaliaSourceStamps").collect()),
  ).toEqual(before);
});

it("retains disabled metadata but rejects deletion, absent libraries, resurrection and retained-data purge", async () => {
  const t = fixture();
  const { libraryId } = await addReader(t, {
    email: "disabled-stamps@example.com",
    status: "disabled",
  });
  const articleId = await t.run((raw) =>
    metadataContext(raw).db.insert("articles", article(libraryId)),
  );
  await migrate(t, libraryId);
  await t.run((raw) =>
    metadataContext(raw).db.patch(articleId, { embeddedAt: 42 }),
  );
  expect((await equal(t, libraryId)).embeddedMax).toBe(42);
  await expect(
    t.run((ctx) => purgeFingerprintMetadata(ctx, libraryId)),
  ).rejects.toThrow("retained");
  await expect(
    t.run((ctx) => purgeFingerprintMetadata(ctx, OWNER)),
  ).rejects.toThrow("retained");
  await t.run(async (ctx) => {
    const reader = await ctx.db.query("readers").first();
    if (!reader) throw new Error("Missing reader");
    await ctx.db.patch(reader._id, { deletingAt: 1 });
  });
  expect(
    await t.mutation(internal.fingerprintMetadata.backfill, {
      userId: libraryId,
    }),
  ).toEqual({ complete: false, retained: false });
  for (let i = 0; i < 3; i++)
    await t.run((ctx) => purgeFingerprintMetadata(ctx, libraryId));
  await t.run((raw) =>
    metadataContext(raw).db.patch(articleId, { embeddedAt: 43 }),
  );
  await t.run((raw) =>
    metadataContext(raw).db.insert("articles", article("absent-library")),
  );
  expect(
    (
      await t.query(internal.fingerprintMetadata.status, {
        userId: "absent-library",
      })
    ).ready,
  ).toBe(false);
  expect(
    await t.mutation(internal.fingerprintMetadata.backfill, {
      userId: "absent-library",
    }),
  ).toEqual({ complete: false, retained: false });
  expect(
    await t.run((ctx) => ctx.db.query("marginaliaSourceStamps").collect()),
  ).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("marginaliaFingerprintState").collect()),
  ).toEqual([]);
});

it("keeps legacy append, same-hash replacement and file deletion indexedAt semantics", async () => {
  const t = fixture();
  const chunk = (indexedAt: number, chunkIndex = 0) => ({
    userId: OWNER,
    filePath: "x.md",
    fileName: "X",
    content: "x",
    embedding: vector,
    fileHash: "same-hash",
    chunkIndex,
    indexedAt,
  });
  await migrate(t);
  await t.mutation(internal.noteChunks.insertBatch, {
    userId: OWNER,
    chunks: [chunk(10), chunk(30, 1)],
  });
  expect((await equal(t)).vaultIndexedMax).toBe(30);
  await t.mutation(internal.noteChunks.replaceFile, {
    userId: OWNER,
    filePath: "x.md",
    chunks: [chunk(20)],
  });
  expect((await equal(t)).vaultIndexedMax).toBe(20);
  await t.mutation(internal.noteChunks.deleteByFile, {
    userId: OWNER,
    filePath: "x.md",
  });
  expect((await equal(t)).vaultIndexedMax).toBe(0);
});

it("publishes source creation time, not metadata insertion time", async () => {
  const t = fixture();
  const id = await t.run((ctx) => ctx.db.insert("articles", article()));
  const row = await t.run((ctx) => ctx.db.get(id));
  if (!row) throw new Error("Missing source");
  expect(
    sourceStamp("articles", { ...row, _creationTime: 7 }).sourceCreationTime,
  ).toBe(7);
});

it("keeps HTML-only public saves as updatedAt signals while job-only patches leave stamps alone", async () => {
  vi.useFakeTimers();
  const t = fixture();
  const { client, libraryId } = await addReader(t, {
    email: "html-stamp@example.com",
  });
  const articleId = await t.run((raw) =>
    metadataContext(raw).db.insert("articles", article(libraryId)),
  );
  const noteId = await client.mutation(api.userNotes.create, {
    articleId,
    selectedText: "A sentence.",
    content: "<p>Text</p>",
    contentPlain: "Text",
  });
  await migrate(t, libraryId);
  const before = await equal(t, libraryId);
  vi.advanceTimersByTime(1);
  await client.mutation(api.userNotes.update, {
    noteId,
    content: "<p><b>Text</b></p>",
    contentPlain: "Text",
  });
  const after = await equal(t, libraryId);
  expect(after.notesMax).toBeGreaterThan(before.notesMax);
  expect(after.embeddedMax).toBe(before.embeddedMax);
  await t.run(async (ctx) => {
    const note = await ctx.db.get(noteId);
    if (!note?.noteIndex) throw new Error("Missing note index job");
    await ctx.db.patch(noteId, {
      noteIndex: { ...note.noteIndex, attempt: 3, dueAt: 0, wakeId: undefined },
    });
  });
  // One native note write is allowed; even a same-value metadata rewrite would
  // exceed this physical write count. No action runs in this exhausted claim.
  await t.run((ctx) =>
    ctx.runMutation(
      internal.userNotes.startIndex,
      { noteId, revision: 1 },
      { transactionLimits: { documentsWritten: 1 } },
    ),
  );
  expect((await t.run((ctx) => ctx.db.get(noteId)))?.noteIndex).toMatchObject({
    status: "failed",
    attempt: 3,
  });
  expect(await equal(t, libraryId)).toEqual(after);
});

it("enforces real read/write amplification budgets for legacy upload and atomic replacement", async () => {
  const t = fixture();
  const chunk = (index: number, bytes: number) => ({
    userId: OWNER,
    filePath: "bulk.md",
    fileName: "Bulk",
    content: "x".repeat(bytes),
    embedding: vector,
    fileHash: "bulk",
    chunkIndex: index,
    indexedAt: index,
  });
  // Source insertion and deletion include all trigger gets, derived records,
  // native writes and manifest publication under actual Convex limits.
  await t.mutation(internal.noteChunks.insertBatch, {
    userId: OWNER,
    chunks: Array.from({ length: 5 }, (_, i) => chunk(i, 900_000)),
  });
  await expect(
    t.mutation(internal.noteChunks.replaceFile, {
      userId: OWNER,
      filePath: "bulk.md",
      chunks: [chunk(0, 900_000)],
    }),
  ).rejects.toThrow(/budget/);
  expect(
    await t.run((ctx) => ctx.db.query("noteChunks").collect()),
  ).toHaveLength(5);
  await expect(
    t.mutation(internal.noteChunks.insertBatch, {
      userId: OWNER,
      chunks: Array.from({ length: 10 }, (_, i) => chunk(i, 900_000)),
    }),
  ).rejects.toThrow(/budget/);
  await t.mutation(internal.noteChunks.replaceFile, {
    userId: OWNER,
    filePath: "small.md",
    chunks: [{ ...chunk(0, 900_000), filePath: "small.md" }],
  });
  await migrate(t);
  expect((await equal(t)).vaultIndexedMax).toBe(4);
});

it("purges only one small batch before returning positive and leaves foreign retained stamps intact", async () => {
  const t = fixture();
  const { libraryId } = await addReader(t, {
    email: "purge-stamps@example.com",
  });
  const articleId = await t.run((raw) =>
    metadataContext(raw).db.insert("articles", article(libraryId)),
  );
  await t.run((raw) => metadataContext(raw).db.insert("articles", article()));
  for (let i = 0; i < 70; i++)
    await t.run((raw) =>
      metadataContext(raw).db.insert("highlights", {
        userId: libraryId,
        articleId,
        kind: "highlight",
        text: "x",
        createdAt: i,
      }),
    );
  await migrate(t, libraryId);
  await t.run(async (ctx) => {
    const reader = await ctx.db.query("readers").first();
    if (!reader) throw new Error("Missing reader");
    await ctx.db.patch(reader._id, { deletingAt: 1 });
  });
  expect(await t.run((ctx) => purgeFingerprintMetadata(ctx, libraryId))).toBe(
    64,
  );
  expect(await t.run((ctx) => purgeFingerprintMetadata(ctx, libraryId))).toBe(
    7,
  );
  expect(await t.run((ctx) => purgeFingerprintMetadata(ctx, libraryId))).toBe(
    1,
  );
  expect(await t.run((ctx) => purgeFingerprintMetadata(ctx, libraryId))).toBe(
    0,
  );
  expect(
    await t.run((ctx) => ctx.db.query("marginaliaSourceStamps").collect()),
  ).toHaveLength(1);
});
