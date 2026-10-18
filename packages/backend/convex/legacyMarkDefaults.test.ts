/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import { purgeLegacyMarkDefaults } from "./highlights";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function fixture(count = 80) {
  const f = await secondReaderTest(modules);
  const ids = await f.t.run(async (ctx) => {
    const articleId = await ctx.db.insert("articles", {
      userId: f.readerLibraryId,
      guid: "legacy-colours",
      url: "https://example.com/colours",
      title: "Colours",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    });
    const old = [];
    for (let i = 0; i < count; i++)
      old.push(
        await ctx.db.insert("highlights", {
          userId: f.readerLibraryId,
          articleId,
          kind: "highlight",
          text: `legacy ${i}`,
          createdAt: i,
          embedding: Array(1536).fill(0.5),
        }),
      );
    const explicit = await ctx.db.insert("highlights", {
      userId: f.readerLibraryId,
      articleId,
      kind: "highlight",
      text: "explicit",
      color: "blue",
      createdAt: 1,
    });
    const underline = await ctx.db.insert("highlights", {
      userId: f.readerLibraryId,
      articleId,
      kind: "underline",
      text: "underline",
      createdAt: 1,
    });
    return { articleId, old, explicit, underline };
  });
  const rows = () =>
    f.t.run((ctx) =>
      ctx.db
        .query("highlights")
        .withIndex("by_userId", (q) => q.eq("userId", f.readerLibraryId))
        .collect(),
    );
  const job = () =>
    f.t.run((ctx) =>
      ctx.db
        .query("legacyMarkDefaults")
        .withIndex("by_userId_and_kind", (q) =>
          q.eq("userId", f.readerLibraryId).eq("kind", "highlight"),
        )
        .unique(),
    );
  const readerRow = () =>
    f.t.run((ctx) =>
      ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", f.readerLibraryId))
        .unique(),
    );
  return { ...f, ...ids, rows, job, readerRow };
}

it("atomically freezes one canonical colour across racing devices and old clients, without repainting explicit marks", async () => {
  const f = await fixture();
  await Promise.all([
    f.reader.mutation(api.highlights.stampUncoloured, {
      kind: "highlight",
      color: "pink",
      expectedReaderId: f.readerLibraryId,
    }),
    f.reader.mutation(api.highlights.stampUncoloured, {
      kind: "highlight",
      color: "green",
    }),
  ]);
  const initial = await f.job();
  if (!initial) throw new Error("Missing migration");
  expect(["pink", "green"]).toContain(initial.color);
  expect(initial.version).toBe(1);
  expect(initial.status).toBe("running");
  const stamped = (await f.rows()).filter((row) => row.color === initial.color);
  expect(stamped).toHaveLength(32);
  const cachedClient = await f.reader.query(api.highlights.listByArticle, {
    articleId: f.articleId,
  });
  expect(
    cachedClient
      .filter((row) => f.old.includes(row._id))
      .every((row) => row.color === initial.color),
  ).toBe(true);
  const leanClient = await f.reader.query(
    api.highlights.listPresentationByArticle,
    { articleId: f.articleId, paginationOpts: { numItems: 50, cursor: null } },
  );
  expect(
    leanClient.page
      .filter((row) => f.old.includes(row._id))
      .every((row) => row.color === initial.color),
  ).toBe(true);
  expect((await f.rows()).find((row) => row._id === f.explicit)?.color).toBe(
    "blue",
  );
  expect(
    (await f.rows()).find((row) => row._id === f.underline)?.color,
  ).toBeUndefined();
  expect(
    (await f.reader.query(api.highlights.legacyDefaults, {})).highlighter,
  ).toEqual({ color: initial.color, version: 1, ready: false });
  expect(await f.owner.query(api.highlights.legacyDefaults, {})).toEqual({
    readerId: "default_user",
    highlighter: null,
    pen: null,
  });
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(
    (await f.rows())
      .filter((row) => f.old.includes(row._id))
      .every((row) => row.color === initial.color),
  ).toBe(true);
  expect((await f.job())?.status).toBe("done");
  const jobs = await f.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  const completed = await f.job();
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "highlight",
    color: "yellow",
  });
  expect(await f.job()).toEqual(completed);
  expect(
    await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    ),
  ).toEqual(jobs);
});

it("resumes from the persisted cursor after a cancelled continuation and keeps the original baseline", async () => {
  const f = await fixture();
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "highlight",
    color: "pink",
  });
  const paused = await f.job();
  if (!paused?.scheduledId) throw new Error("Missing continuation");
  const scheduledId = paused.scheduledId;
  await f.t.run((ctx) => ctx.scheduler.cancel(scheduledId));
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "highlight",
    color: "green",
  });
  expect((await f.job())?.color).toBe("pink");
  expect((await f.rows()).filter((row) => row.color === "pink")).toHaveLength(
    64,
  );
  // A duplicate/stale cursor cannot restart or skip work.
  const afterResume = await f.job();
  await f.t.mutation(internal.highlights.stampLegacyPage, {
    jobId: paused._id,
    cursor: paused.cursor,
  });
  expect(await f.job()).toEqual(afterResume);
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(
    (await f.rows())
      .filter((row) => f.old.includes(row._id))
      .every((row) => row.color === "pink"),
  ).toBe(true);
});

it("does no writes when disabled before continuation, then resumes safely on reactivation", async () => {
  const f = await fixture();
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "highlight",
    color: "pink",
  });
  const reader = await f.readerRow();
  if (!reader) throw new Error("Missing reader");
  await f.t.run((ctx) => ctx.db.patch(reader._id, { status: "disabled" }));
  const before = await f.rows();
  const jobBefore = await f.job();
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(await f.rows()).toEqual(before);
  expect(await f.job()).toEqual(jobBefore);
  await f.t.run((ctx) => ctx.db.patch(reader._id, { status: "active" }));
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "highlight",
    color: "green",
  });
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect((await f.job())?.status).toBe("done");
  expect(
    (await f.rows())
      .filter((row) => f.old.includes(row._id))
      .every((row) => row.color === "pink"),
  ).toBe(true);
});

it("checks deletingAt separately, purges a bounded count and never revives metadata from new or legacy queued pages", async () => {
  const f = await fixture();
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "highlight",
    color: "pink",
  });
  const reader = await f.readerRow();
  const job = await f.job();
  if (!reader || !job) throw new Error("Missing fixture rows");
  await expect(
    f.t.run((ctx) => purgeLegacyMarkDefaults(ctx, f.readerLibraryId)),
  ).rejects.toThrow("active library");
  await f.t.run((ctx) => ctx.db.patch(reader._id, { deletingAt: 0 }));
  const before = await f.rows();
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "underline",
    color: "forest",
  });
  expect(
    (await f.reader.query(api.highlights.legacyDefaults, {})).pen,
  ).toBeNull();
  await f.t.mutation(internal.highlights.stampLegacyPage, {
    jobId: job._id,
    cursor: job.cursor,
  });
  expect(await f.rows()).toEqual(before);
  expect(
    await f.t.run((ctx) => purgeLegacyMarkDefaults(ctx, f.readerLibraryId)),
  ).toBe(1);
  expect(
    await f.t.run((ctx) => purgeLegacyMarkDefaults(ctx, f.readerLibraryId)),
  ).toBe(0);
  await f.t.mutation(internal.highlights.stampLegacyPage, {
    jobId: job._id,
    cursor: job.cursor,
  });
  await f.t.mutation(internal.highlights.stampUncolouredPage, {
    userId: f.readerLibraryId,
    kind: "highlight",
    color: "green",
    cursor: job.cursor ?? "",
  });
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(await f.job()).toBeNull();
  expect(await f.rows()).toEqual(before);
});

it("gives old uncoloured creates the canonical baseline and never overrides a new mark's explicit colour", async () => {
  const f = await fixture(0);
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "highlight",
    color: "pink",
  });
  const oldClient = await f.reader.mutation(api.highlights.create, {
    articleId: f.articleId,
    kind: "highlight",
    text: "old client",
  });
  const newClient = await f.reader.mutation(api.highlights.create, {
    articleId: f.articleId,
    kind: "highlight",
    color: "green",
    text: "new default",
  });
  expect((await f.rows()).find((row) => row._id === oldClient)?.color).toBe(
    "pink",
  );
  expect((await f.rows()).find((row) => row._id === newClient)?.color).toBe(
    "green",
  );
});

it("rejects a queued kickoff crossing reader identity and does not read another reader's baseline", async () => {
  const f = await fixture(0);
  await expect(
    f.owner.mutation(api.highlights.stampUncoloured, {
      kind: "highlight",
      color: "pink",
      expectedReaderId: f.readerLibraryId,
    }),
  ).rejects.toThrow("reader changed");
  expect(await f.owner.query(api.highlights.legacyDefaults, {})).toEqual({
    readerId: "default_user",
    highlighter: null,
    pen: null,
  });
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "underline",
    color: "forest",
  });
  expect((await f.reader.query(api.highlights.legacyDefaults, {})).pen).toEqual(
    { color: "forest", version: 1, ready: true },
  );
});

it("keeps the historic clear-colour repair only before initialization; an existing canonical baseline requires explicit corrected colours", async () => {
  const f = await fixture(0);
  expect(
    await f.t.mutation(internal.highlights.clearStoredColour, {
      userId: f.readerLibraryId,
      ids: [f.explicit],
    }),
  ).toBe(1);
  expect(
    (await f.rows()).find((row) => row._id === f.explicit)?.color,
  ).toBeUndefined();
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "highlight",
    color: "pink",
  });
  await expect(
    f.t.mutation(internal.highlights.clearStoredColour, {
      userId: f.readerLibraryId,
      ids: [f.explicit],
    }),
  ).rejects.toThrow("Clearing does not reset");
  expect((await f.rows()).find((row) => row._id === f.explicit)?.color).toBe(
    "pink",
  );
  await f.reader.mutation(api.highlights.setColor, {
    highlightId: f.explicit,
    color: "green",
  });
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "highlight",
    color: "yellow",
  });
  expect((await f.rows()).find((row) => row._id === f.explicit)?.color).toBe(
    "green",
  );
  expect(
    (await f.reader.query(api.highlights.legacyDefaults, {})).highlighter
      ?.color,
  ).toBe("pink");
});

it("fills near-limit legacy rows without truncating their text or embedding", async () => {
  const f = await fixture(0);
  const id = await f.t.run((ctx) =>
    ctx.db.insert("highlights", {
      userId: f.readerLibraryId,
      articleId: f.articleId,
      kind: "highlight",
      text: "😀".repeat(200_000),
      embedding: Array(1536).fill(0.25),
      createdAt: 1,
    }),
  );
  await f.reader.mutation(api.highlights.stampUncoloured, {
    kind: "highlight",
    color: "pink",
  });
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const row = await f.t.run((ctx) => ctx.db.get(id));
  expect(row?.color).toBe("pink");
  expect(row?.text).toBe("😀".repeat(200_000));
  expect(row?.embedding).toEqual(Array(1536).fill(0.25));
});
