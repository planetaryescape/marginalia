/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { CLAIM_TTL_MS, MAX_PASSES_PER_ARTICLE } from "./alongside";
import {
  computeFingerprint,
  sameFingerprint,
} from "./lib/marginaliaFingerprint";
import { sectionRanges } from "./lib/readingSections";
import { READER_LIMITS } from "./limits";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const vector = Array.from({ length: 1536 }, () => 0.5);
// Opposite direction: the vector search finds nothing that close, which
// convex-test needs in place of a row with no embedding
const far = vector.map((x) => -x);
const CONTENT = Array.from(
  { length: 700 },
  (_, i) => `Claim ${i} holds in this setting.`,
).join(" ");
const SECTIONS = sectionRanges(CONTENT);
// Anchors inside the second section, and one inside the fourth
const ANCHOR_1 = "Claim 120 holds in this setting.";
const ANCHOR_1B = "Claim 130 holds in this setting.";
const ANCHOR_2 = "Claim 300 holds in this setting.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  vi.stubEnv("OPENROUTER_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

async function fixture() {
  const f = await secondReaderTest(modules);
  const articleId = await f.t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: f.readerLibraryId,
      guid: "a",
      url: "https://example.com/a",
      title: "A long piece",
      content: CONTENT,
      wordCount: 4_000,
      estimatedReadMinutes: 18,
      embedding: vector,
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: Date.now(),
    }),
  );
  // The import pass's fingerprint, as annotateArticle stamps it
  await stamp(f, articleId, f.readerLibraryId);
  return { ...f, articleId };
}

async function stamp(f: Fixture, articleId: Id<"articles">, userId: string) {
  await f.t.run(async (ctx) =>
    ctx.db.patch(articleId, {
      marginaliaFingerprint: await computeFingerprint(ctx, userId),
    }),
  );
}

let clock = 1_000;
const tick = () => ++clock;

/** A note on some other article, which moves the notes signal. */
function addNote(f: Fixture, userId: string, withEmbedding = false) {
  return f.t.run(async (ctx) => {
    const other = await ctx.db.insert("articles", {
      userId,
      guid: `o${tick()}`,
      url: "https://example.com/o",
      title: "Another article",
      embedding: far,
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: Date.now(),
    });
    return ctx.db.insert("userNotes", {
      userId,
      articleId: other,
      selectedText: "Text",
      content: "<p>Mine</p>",
      contentPlain: "Remote teams need written culture.",
      embedding: withEmbedding ? vector : far,
      createdAt: tick(),
      updatedAt: tick() + 1_000_000,
    });
  });
}

function addHighlight(f: Fixture, userId: string, withEmbedding = false) {
  return f.t.run(async (ctx) => {
    const other = await ctx.db.insert("articles", {
      userId,
      guid: `h${tick()}`,
      url: "https://example.com/h",
      title: "Highlighted article",
      embedding: far,
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: Date.now(),
    });
    return ctx.db.insert("highlights", {
      userId,
      articleId: other,
      kind: "highlight",
      text: "A passage",
      embedding: withEmbedding ? vector : far,
      createdAt: tick(),
    });
  });
}

const passJobs = (f: Fixture) =>
  f.t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").take(500)).filter((j) =>
      j.name.includes("readAlongside"),
    ),
  );

const rowFor = (f: Fixture, articleId: Id<"articles">, section: number) =>
  f.t.run(async (ctx) =>
    ctx.db
      .query("marginaliaPasses")
      .withIndex("by_userId_and_articleId_and_sectionIndex", (q) =>
        q
          .eq("userId", f.readerLibraryId)
          .eq("articleId", articleId)
          .eq("sectionIndex", section),
      )
      .unique(),
  );

describe("the cheap gate", () => {
  it("is moved by each signal, and only by them", async () => {
    const f = await secondReaderTest(modules);
    const at = () =>
      f.t.run((ctx) => computeFingerprint(ctx, f.readerLibraryId));
    const base = await at();
    expect(sameFingerprint(base, { ...base, passAt: base.passAt + 99 })).toBe(
      true,
    );

    await addNote(f, f.readerLibraryId);
    const afterNote = await at();
    expect(afterNote.notesMax).toBeGreaterThan(base.notesMax);
    expect(sameFingerprint(base, afterNote)).toBe(false);

    await f.t.run(async (ctx) => {
      const article = await ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        guid: "t",
        url: "https://example.com/t",
        title: "T",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
      await ctx.db.insert("companionThreads", {
        userId: f.readerLibraryId,
        articleId: article,
        mode: "ask",
        selection: "x",
        turns: [{ role: "user", content: "Why?" }],
        createdAt: 5,
        updatedAt: 5_000_000,
      });
    });
    const afterThread = await at();
    expect(afterThread.threadsMax).toBe(5_000_000);
    expect(sameFingerprint(afterNote, afterThread)).toBe(false);

    await addHighlight(f, f.readerLibraryId);
    const afterHighlight = await at();
    expect(afterHighlight.highlightsCount).toBe(1);
    expect(afterHighlight.highlightsMax).toBeGreaterThan(0);
    expect(sameFingerprint(afterThread, afterHighlight)).toBe(false);

    await f.t.run((ctx) =>
      ctx.db.insert("noteChunks", {
        userId: f.readerLibraryId,
        filePath: "Vault/a.md",
        fileName: "a.md",
        chunkIndex: 0,
        content: "vault",
        embedding: vector,
        fileHash: "h",
        indexedAt: 7_000_000,
      }),
    );
    const afterVault = await at();
    expect(afterVault.vaultIndexedMax).toBe(7_000_000);
    expect(sameFingerprint(afterHighlight, afterVault)).toBe(false);
  });

  it("catches a deleted highlight through the count", async () => {
    const f = await secondReaderTest(modules);
    const first = await addHighlight(f, f.readerLibraryId);
    await addHighlight(f, f.readerLibraryId);
    const before = await f.t.run((ctx) =>
      computeFingerprint(ctx, f.readerLibraryId),
    );
    // The newest is kept, so the maximum alone would not move
    await f.t.run((ctx) => ctx.db.delete(first));
    const after = await f.t.run((ctx) =>
      computeFingerprint(ctx, f.readerLibraryId),
    );
    expect(after.highlightsMax).toBe(before.highlightsMax);
    expect(after.highlightsCount).toBe(before.highlightsCount - 1);
    expect(sameFingerprint(before, after)).toBe(false);
  });

  it("does not read another reader's library", async () => {
    const f = await secondReaderTest(modules);
    const before = await f.t.run((ctx) => computeFingerprint(ctx, OWNER));
    await addNote(f, f.readerLibraryId);
    await addHighlight(f, f.readerLibraryId);
    const after = await f.t.run((ctx) => computeFingerprint(ctx, OWNER));
    expect(sameFingerprint(before, after)).toBe(true);
  });
});

describe("the trigger", () => {
  it("makes no call and says why when nothing has changed", async () => {
    const f = await fixture();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const status = await f.reader.mutation(api.alongside.requestAhead, {
      articleId: f.articleId,
      currentSection: 0,
    });
    expect(status).toBe("unchanged");
    expect(await passJobs(f)).toHaveLength(0);
    expect(await rowFor(f, f.articleId, 1)).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /Skipped reading pass for "A long piece" \(\S+\) section 2: nothing the margin draws on has changed since \d{4}-/,
      ),
    );
  });

  it("starts from what the library holds now when the article has no fingerprint", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.patch(f.articleId, { marginaliaFingerprint: undefined }),
    );
    expect(
      await f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 0,
      }),
    ).toBe("baseline");
    expect(await passJobs(f)).toHaveLength(0);
    expect(
      await f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 0,
      }),
    ).toBe("unchanged");
  });

  it("claims and schedules only the next section, and only once", async () => {
    const f = await fixture();
    await addNote(f, f.readerLibraryId);
    const request = () =>
      f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 1,
      });
    // Two tabs, or a fast scroll, at once
    const results = await Promise.all([request(), request()]);
    expect(results.sort()).toEqual(["running", "scheduled"]);
    expect(await passJobs(f)).toHaveLength(1);
    const row = await rowFor(f, f.articleId, 2);
    expect(row).toMatchObject({ status: "running", calls: 1 });
    expect(await rowFor(f, f.articleId, 1)).toBeNull();
    expect(await rowFor(f, f.articleId, 3)).toBeNull();
    expect(
      await f.reader.query(api.alongside.workingSections, {
        articleId: f.articleId,
      }),
    ).toEqual([2]);
  });

  it("lets a crashed claim be taken again after its time is up", async () => {
    const f = await fixture();
    await addNote(f, f.readerLibraryId);
    const request = () =>
      f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 0,
      });
    expect(await request()).toBe("scheduled");
    vi.setSystemTime(Date.now() + CLAIM_TTL_MS + 1);
    expect(await request()).toBe("scheduled");
    expect(await passJobs(f)).toHaveLength(2);
  });

  it("refuses sections that do not exist, books, and articles not yet annotated", async () => {
    const f = await fixture();
    await addNote(f, f.readerLibraryId);
    const ask = (currentSection: number) =>
      f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection,
      });
    expect(await ask(SECTIONS.length - 1)).toBe("ineligible");
    expect(await ask(-1)).toBe("ineligible");
    expect(await ask(0.5)).toBe("ineligible");
    await f.t.run((ctx) => ctx.db.patch(f.articleId, { bookUnitCount: 3 }));
    expect(await ask(0)).toBe("ineligible");
    await f.t.run((ctx) =>
      ctx.db.patch(f.articleId, {
        bookUnitCount: undefined,
        annotationStatus: "pending",
      }),
    );
    expect(await ask(0)).toBe("ineligible");
    expect(await passJobs(f)).toHaveLength(0);
  });
});

describe("budgets", () => {
  async function settleDone(f: Awaited<ReturnType<typeof fixture>>) {
    const row = await rowFor(f, f.articleId, 1);
    if (!row) throw new Error("no claim");
    await f.t.mutation(internal.alongside.settle, {
      userId: f.readerLibraryId,
      articleId: f.articleId,
      sectionIndex: 1,
      claim: row.claim,
      outcome: "done",
    });
  }

  it("stops quietly at the article's pass budget", async () => {
    const f = await fixture();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (let i = 0; i < MAX_PASSES_PER_ARTICLE; i++) {
      await addHighlight(f, f.readerLibraryId);
      expect(
        await f.reader.mutation(api.alongside.requestAhead, {
          articleId: f.articleId,
          currentSection: 0,
        }),
      ).toBe("scheduled");
      await settleDone(f);
    }
    await addHighlight(f, f.readerLibraryId);
    expect(
      await f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 0,
      }),
    ).toBe("budget");
    expect(await passJobs(f)).toHaveLength(MAX_PASSES_PER_ARTICLE);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("the article's pass budget is used"),
    );
  });

  it("stops quietly at the reader's daily cap, and never touches the cap of another reader", async () => {
    const f = await fixture();
    await addNote(f, f.readerLibraryId);
    await f.t.run((ctx) =>
      ctx.db.insert("readerLimits", {
        userId: f.readerLibraryId,
        bucket: "alongsideDaily",
        startedAt: Date.now(),
        count: READER_LIMITS.alongsideDaily.max,
      }),
    );
    expect(
      await f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 0,
      }),
    ).toBe("budget");
    expect(await passJobs(f)).toHaveLength(0);
    expect(await rowFor(f, f.articleId, 1)).toBeNull();

    // The owner's own reading is unaffected
    const ownerArticle = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("articles", {
        userId: OWNER,
        guid: "own",
        url: "https://example.com/own",
        title: "Owner piece",
        content: CONTENT,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      });
      await ctx.db.patch(id, {
        marginaliaFingerprint: await computeFingerprint(ctx, OWNER),
      });
      return id;
    });
    await f.t.run((ctx) =>
      ctx.db.insert("highlights", {
        userId: OWNER,
        articleId: ownerArticle,
        kind: "highlight",
        text: "x",
        createdAt: tick(),
      }),
    );
    expect(
      await f.owner.mutation(api.alongside.requestAhead, {
        articleId: ownerArticle,
        currentSection: 0,
      }),
    ).toBe("scheduled");
  });
});

describe("settling a pass", () => {
  const note = (anchor: string, content: string) => {
    const start = CONTENT.indexOf(anchor);
    return {
      type: "assumption" as const,
      anchorText: anchor,
      anchorStartOffset: start,
      anchorEndOffset: start + anchor.length,
      content,
      relevanceScore: 0.8,
    };
  };

  async function claimed() {
    const f = await fixture();
    await addNote(f, f.readerLibraryId);
    await f.reader.mutation(api.alongside.requestAhead, {
      articleId: f.articleId,
      currentSection: 0,
    });
    const row = await rowFor(f, f.articleId, 1);
    if (!row) throw new Error("no claim");
    return { ...f, claim: row.claim };
  }
  const settleArgs = (f: Awaited<ReturnType<typeof claimed>>) => ({
    userId: f.readerLibraryId,
    articleId: f.articleId,
    sectionIndex: 1,
    claim: f.claim,
  });

  it("adds notes and leaves every existing note exactly as it was", async () => {
    const f = await claimed();
    const existing = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("annotations", {
        articleId: f.articleId,
        userId: f.readerLibraryId,
        ...note(ANCHOR_1, "The old point."),
        type: "crux",
        wasViewed: true,
        wasDismissed: false,
        createdAt: 5,
      });
      return ctx.db.get(id);
    });
    const added = await f.t.mutation(internal.alongside.settle, {
      ...settleArgs(f),
      outcome: "done",
      contextHash: "abc",
      notes: [
        // Sits on the existing note's anchor: dropped
        note(ANCHOR_1, "The same point again."),
        note(ANCHOR_1B, "A new point."),
      ],
    });
    expect(added).toBe(1);
    const all = await f.t.run((ctx) =>
      ctx.db
        .query("annotations")
        .withIndex("by_article", (q) => q.eq("articleId", f.articleId))
        .collect(),
    );
    expect(all).toHaveLength(2);
    expect(all.find((a) => a._id === existing?._id)).toEqual(existing);
    expect(all.map((a) => a.content).sort()).toEqual([
      "A new point.",
      "The old point.",
    ]);
    const row = await rowFor(f, f.articleId, 1);
    expect(row).toMatchObject({
      status: "done",
      notesAdded: 1,
      contextHash: "abc",
    });
    // Settled: the same library no longer asks for a call
    expect(
      await f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 0,
      }),
    ).toBe("unchanged");
  });

  it("writes nothing when its claim was replaced", async () => {
    const f = await claimed();
    expect(
      await f.t.mutation(internal.alongside.settle, {
        ...settleArgs(f),
        claim: f.claim - 1,
        outcome: "done",
        notes: [note(ANCHOR_1, "Stale.")],
      }),
    ).toBe(0);
    expect(
      await f.t.run((ctx) => ctx.db.query("annotations").collect()),
    ).toHaveLength(0);
    expect((await rowFor(f, f.articleId, 1))?.status).toBe("running");
  });

  it("gives back the budget when no model call was made, and keeps it when one failed", async () => {
    const f = await claimed();
    await f.t.mutation(internal.alongside.settle, {
      ...settleArgs(f),
      outcome: "skipped",
      contextHash: "same",
    });
    expect(await rowFor(f, f.articleId, 1)).toMatchObject({
      status: "skipped",
      calls: 0,
    });
    const limit = await f.t.run((ctx) =>
      ctx.db
        .query("readerLimits")
        .withIndex("by_userId_and_bucket", (q) =>
          q.eq("userId", f.readerLibraryId).eq("bucket", "alongsideDaily"),
        )
        .unique(),
    );
    expect(limit?.count).toBe(0);

    // A failed pass leaves the fingerprint, so the next trigger tries again
    await addHighlight(f, f.readerLibraryId);
    await f.reader.mutation(api.alongside.requestAhead, {
      articleId: f.articleId,
      currentSection: 0,
    });
    const row = await rowFor(f, f.articleId, 1);
    await f.t.mutation(internal.alongside.settle, {
      ...settleArgs(f),
      claim: row?.claim ?? 0,
      outcome: "failed",
    });
    expect(await rowFor(f, f.articleId, 1)).toMatchObject({
      status: "failed",
      calls: 1,
    });
    expect(
      await f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 0,
      }),
    ).toBe("scheduled");
  });

  it("refuses to write into a library that is being deleted", async () => {
    const f = await claimed();
    await f.t.run(async (ctx) => {
      const reader = await ctx.db.query("readers").first();
      if (reader) await ctx.db.patch(reader._id, { status: "disabled" });
    });
    await expect(
      f.t.mutation(internal.alongside.settle, {
        ...settleArgs(f),
        outcome: "done",
        notes: [note(ANCHOR_1, "Late.")],
      }),
    ).rejects.toThrow("no longer active");
    expect(
      await f.t.run((ctx) => ctx.db.query("annotations").collect()),
    ).toHaveLength(0);
  });

  it("drops a connection to an article outside the library", async () => {
    const f = await claimed();
    const foreign = await f.t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: OWNER,
        guid: "secret",
        url: "https://example.com/secret",
        title: "Secret",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      }),
    );
    expect(
      await f.t.mutation(internal.alongside.settle, {
        ...settleArgs(f),
        outcome: "done",
        notes: [
          {
            ...note(ANCHOR_1, "Links out."),
            type: "cross_reference" as const,
            articleRefId: foreign,
          },
        ],
      }),
    ).toBe(0);
  });
});

describe("a re-annotation", () => {
  it("clears the pass rows, so a stale pass cannot write into the new margin", async () => {
    const f = await fixture();
    await addNote(f, f.readerLibraryId);
    await f.reader.mutation(api.alongside.requestAhead, {
      articleId: f.articleId,
      currentSection: 0,
    });
    const row = await rowFor(f, f.articleId, 1);
    const fingerprint = await f.t.run((ctx) =>
      computeFingerprint(ctx, f.readerLibraryId),
    );
    await f.t.mutation(internal.annotations.replaceForArticle, {
      articleId: f.articleId,
      userId: f.readerLibraryId,
      notes: [],
      reflection: {
        strongestPoint: "s",
        weakestAssumption: "w",
        credibleCounterview: "c",
        questionForYou: "q",
      },
      fingerprint,
      sources: ["note:b:2", "chunk:a:1", "note:b:2"],
    });
    expect(await rowFor(f, f.articleId, 1)).toBeNull();
    const article = await f.t.run((ctx) => ctx.db.get(f.articleId));
    expect(article?.marginaliaFingerprint).toEqual(fingerprint);
    // What the import drew on, for a section's first pass to compare with
    expect(article?.marginaliaSources).toEqual(["chunk:a:1", "note:b:2"]);
    expect(
      await f.t.mutation(internal.alongside.settle, {
        userId: f.readerLibraryId,
        articleId: f.articleId,
        sectionIndex: 1,
        claim: row?.claim ?? 0,
        outcome: "done",
      }),
    ).toBe(0);
  });
});

describe("two readers", () => {
  it("cannot reach each other's articles, passes or progress", async () => {
    const f = await fixture();
    await addNote(f, f.readerLibraryId);
    await f.reader.mutation(api.alongside.requestAhead, {
      articleId: f.articleId,
      currentSection: 0,
    });
    expect(
      await f.owner.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 0,
      }),
    ).toBe("ineligible");
    expect(
      await f.owner.query(api.alongside.workingSections, {
        articleId: f.articleId,
      }),
    ).toEqual([]);
    expect(await passJobs(f)).toHaveLength(1);
  });

  it("does not move one reader's gate with the other's notes", async () => {
    const f = await fixture();
    await addNote(f, OWNER);
    expect(
      await f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 0,
      }),
    ).toBe("unchanged");
  });
});

describe("the pass", () => {
  // Vector search needs real timers; the scheduled pass is awaited by hand
  beforeEach(() => {
    vi.useRealTimers();
  });

  async function run(
    respond: () => unknown,
    options: {
      onEmbeddings?: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>;
    } = {},
  ) {
    const f = await fixture();
    await saveTestCredential(
      f.t,
      f.readerLibraryId,
      "openrouter",
      "sk-or-fixture-0001",
    );
    const prompts: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body));
        if (String(input).endsWith("/embeddings")) {
          await options.onEmbeddings?.(f);
          return Response.json({
            data: (request.input as string[]).map((_, index) => ({
              index,
              embedding: vector,
            })),
          });
        }
        prompts.push(JSON.stringify(request.messages));
        return Response.json({
          id: "x",
          created: 1,
          model: request.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify(respond()),
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    );
    const request = async (currentSection = 0) => {
      const status = await f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection,
      });
      // The scheduled pass runs here, as it would on the server
      await new Promise((resolve) => setTimeout(resolve, 5));
      await f.t.finishInProgressScheduledFunctions();
      return status;
    };
    const notes = () =>
      f.t.run((ctx) =>
        ctx.db
          .query("annotations")
          .withIndex("by_article", (q) => q.eq("articleId", f.articleId))
          .collect(),
      );
    return { ...f, prompts, request, notes };
  }

  const candidate = (anchorText: string, content: string) => ({
    type: "assumption",
    anchorText,
    content,
    relevanceScore: 0.8,
    reasoning: "r",
  });

  it("adds notes to the section ahead only, tells the model what is already said, and then rests", async () => {
    const f = await run(() => ({
      annotations: [
        candidate(ANCHOR_1, "The same old point."),
        candidate(ANCHOR_1B, "A new point."),
        // A passage in a different section: not the one being read
        candidate(ANCHOR_2, "Wrong section."),
      ],
    }));
    const existing = await f.t.run(async (ctx) => {
      const start = CONTENT.indexOf(ANCHOR_1);
      const id = await ctx.db.insert("annotations", {
        articleId: f.articleId,
        userId: f.readerLibraryId,
        type: "crux",
        anchorText: ANCHOR_1,
        anchorStartOffset: start,
        anchorEndOffset: start + ANCHOR_1.length,
        content: "The old point, already in the margin.",
        relevanceScore: 0.9,
        wasViewed: false,
        wasDismissed: false,
        createdAt: 5,
      });
      return ctx.db.get(id);
    });
    await addNote(f, f.readerLibraryId, true);

    expect(await f.request()).toBe("scheduled");
    expect(f.prompts).toHaveLength(1);
    expect(f.prompts[0]).toContain("The old point, already in the margin.");
    expect(f.prompts[0]).toContain("Already said in this section");

    const notes = await f.notes();
    const added = notes.filter((n) => n._id !== existing?._id);
    expect(added.map((n) => n.content)).toEqual(["A new point."]);
    expect(notes.find((n) => n._id === existing?._id)).toEqual(existing);
    const [note] = added;
    expect(CONTENT.slice(note.anchorStartOffset, note.anchorEndOffset)).toBe(
      ANCHOR_1B,
    );
    expect(note.anchorStartOffset).toBeGreaterThanOrEqual(SECTIONS[1].start);
    expect(note.anchorEndOffset).toBeLessThanOrEqual(SECTIONS[1].end);

    // Nothing has changed since: no call, and the log says so
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await f.request()).toBe("unchanged");
    expect(f.prompts).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("nothing the margin draws on has changed"),
    );
  });

  it("skips the model when the fingerprint moved but this section's material did not", async () => {
    const f = await run(() => ({
      annotations: [candidate(ANCHOR_1B, "A new point.")],
    }));
    await addNote(f, f.readerLibraryId, true);
    expect(await f.request()).toBe("scheduled");
    expect(f.prompts).toHaveLength(1);
    const before = await f.notes();

    // A highlight without an embedding cannot be retrieved: the cheap gate
    // moves, the section's retrieval does not
    await addHighlight(f, f.readerLibraryId, false);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await f.request()).toBe("scheduled");
    expect(f.prompts).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /Skipped reading pass for "A long piece" \(\S+\) section 2: the material it would draw on is unchanged \(\d+ items\)/,
      ),
    );
    expect(await f.notes()).toEqual(before);
    // The skipped pass cost nothing against the article's budget
    expect(await rowFor(f, f.articleId, 1)).toMatchObject({
      status: "skipped",
      calls: 1,
    });
    // And the cheap gate is settled again
    expect(await f.request()).toBe("unchanged");
  });

  it("calls the model again when the material it would draw on has changed", async () => {
    const f = await run(() => ({
      annotations: [candidate(ANCHOR_1B, "A new point.")],
    }));
    await addNote(f, f.readerLibraryId, true);
    await f.request();
    await addNote(f, f.readerLibraryId, true);
    await f.request();
    expect(f.prompts).toHaveLength(2);
  });

  it("stops without a model call when the reader has no key", async () => {
    const f = await fixture();
    await addNote(f, f.readerLibraryId, true);
    await f.reader.mutation(api.alongside.requestAhead, {
      articleId: f.articleId,
      currentSection: 0,
    });
    const row = await rowFor(f, f.articleId, 1);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await f.t.action(internal.actions.readAlongside.pass, {
      articleId: f.articleId,
      sectionIndex: 1,
      claim: row?.claim ?? 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("no AI provider key"),
    );
    expect(await rowFor(f, f.articleId, 1)).toMatchObject({
      status: "skipped",
      calls: 0,
    });
  });

  it("calls the model for an embedding that landed after an earlier pass settled", async () => {
    const f = await run(() => ({
      annotations: [candidate(ANCHOR_1B, "A new point.")],
    }));
    // The note exists but cannot be found yet: its embedding is still on its way
    const noteId = await addNote(f, f.readerLibraryId, false);
    expect(await f.request()).toBe("scheduled");
    expect(f.prompts).toHaveLength(0);
    expect(await f.request()).toBe("unchanged");

    const note = await f.t.run((ctx) => ctx.db.get(noteId));
    await f.t.mutation(internal.userNotes.setEmbedding, {
      noteId,
      embedding: vector,
      contentPlain: note?.contentPlain ?? "",
    });
    expect(await f.request()).toBe("scheduled");
    expect(f.prompts).toHaveLength(1);
  });

  it("skips a first pass when nothing it retrieved is new since the import", async () => {
    const f = await run(() => ({
      annotations: [candidate(ANCHOR_1B, "A new point.")],
    }));
    const noteId = await addNote(f, f.readerLibraryId, true);
    const note = await f.t.run((ctx) => ctx.db.get(noteId));
    // What the import pass drew on, as it records it
    await f.t.run((ctx) =>
      ctx.db.patch(f.articleId, {
        marginaliaSources: [`note:${noteId}:${note?.updatedAt}`],
      }),
    );
    await addHighlight(f, f.readerLibraryId);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await f.request()).toBe("scheduled");
    expect(f.prompts).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /section 2: nothing it retrieved is new since the import pass \(1 items\)/,
      ),
    );
    expect(await rowFor(f, f.articleId, 1)).toMatchObject({
      status: "skipped",
      calls: 0,
    });

    // Something new it retrieves does earn a call
    await addNote(f, f.readerLibraryId, true);
    expect(await f.request()).toBe("scheduled");
    expect(f.prompts).toHaveLength(1);
  });

  it("skips a first pass when retrieval returns nothing and the import recorded its sources", async () => {
    const f = await run(() => ({ annotations: [] }));
    await f.t.run((ctx) =>
      ctx.db.patch(f.articleId, { marginaliaSources: [] }),
    );
    await addNote(f, f.readerLibraryId, false);
    expect(await f.request()).toBe("scheduled");
    expect(f.prompts).toHaveLength(0);
  });

  it("notices a library article that appears or changes", async () => {
    const f = await run(() => ({
      annotations: [candidate(ANCHOR_1B, "A new point.")],
    }));
    // A new connection becomes findable when its embedding arrives
    const libraryId = await f.t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        guid: "lib",
        url: "https://example.com/lib",
        title: "Remote teams",
        excerpt: "First version.",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    await f.t.mutation(internal.articles.setEmbedding, {
      articleId: libraryId,
      embedding: vector,
    });
    expect(await f.request()).toBe("scheduled");
    expect(f.prompts).toHaveLength(1);

    // Its text changes with the embedding still in place: the precise hash moves
    await f.t.run(async (ctx) => {
      await ctx.db.patch(libraryId, {
        excerpt: "Second version.",
        embeddedAt: Date.now() + 10_000,
      });
    });
    expect(await f.request()).toBe("scheduled");
    expect(f.prompts).toHaveLength(2);
  });

  it("stops a job whose claim was taken while it retrieved, before any model call", async () => {
    let stolen = false;
    const f = await run(() => ({ annotations: [] }), {
      onEmbeddings: async (g) => {
        if (stolen) return;
        stolen = true;
        // Another tab reclaims the section mid-retrieval
        await g.t.run(async (ctx) => {
          const row = await ctx.db.query("marginaliaPasses").first();
          if (row)
            await ctx.db.patch(row._id, {
              claim: row.claim + 10,
              leaseUntil: Date.now() + CLAIM_TTL_MS,
            });
        });
      },
    });
    await addNote(f, f.readerLibraryId, true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await f.request();
    expect(f.prompts).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("its claim was replaced"),
    );
    expect(await rowFor(f, f.articleId, 1)).toMatchObject({
      status: "running",
    });
    expect(await f.notes()).toHaveLength(0);
  });

  it("does nothing for a library that is being deleted", async () => {
    const f = await run(() => ({ annotations: [] }));
    await addNote(f, f.readerLibraryId, true);
    await f.reader.mutation(api.alongside.requestAhead, {
      articleId: f.articleId,
      currentSection: 0,
    });
    const row = await rowFor(f, f.articleId, 1);
    await f.t.run(async (ctx) => {
      const reader = await ctx.db.query("readers").first();
      if (reader) await ctx.db.patch(reader._id, { status: "disabled" });
    });
    const claim = {
      articleId: f.articleId,
      sectionIndex: 1,
      claim: row?.claim ?? 0,
    };
    expect(await f.t.query(internal.alongside.passInput, claim)).toBeNull();
    expect(
      await f.t.mutation(internal.alongside.renew, {
        userId: f.readerLibraryId,
        ...claim,
      }),
    ).toBe(false);
    await f.t.action(internal.actions.readAlongside.pass, claim);
    expect(f.prompts).toHaveLength(0);
  });
});

describe("the lease", () => {
  it("is extended by renew, and only for the job holding the claim", async () => {
    const f = await fixture();
    await addNote(f, f.readerLibraryId);
    await f.reader.mutation(api.alongside.requestAhead, {
      articleId: f.articleId,
      currentSection: 0,
    });
    const row = await rowFor(f, f.articleId, 1);
    const args = {
      userId: f.readerLibraryId,
      articleId: f.articleId,
      sectionIndex: 1,
    };
    vi.setSystemTime(Date.now() + CLAIM_TTL_MS - 1_000);
    expect(
      await f.t.mutation(internal.alongside.renew, {
        ...args,
        claim: (row?.claim ?? 0) + 1,
      }),
    ).toBe(false);
    expect(
      await f.t.mutation(internal.alongside.renew, {
        ...args,
        claim: row?.claim ?? 0,
      }),
    ).toBe(true);
    // Past the original lease, but renewed: still running
    vi.setSystemTime(Date.now() + 5_000);
    expect(
      await f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 0,
      }),
    ).toBe("running");
  });
});

describe("the retrieval budget", () => {
  it("is spent by every claim, and not given back by a skip", async () => {
    const f = await fixture();
    const limit = (bucket: string) =>
      f.t.run(
        async (ctx) =>
          (
            await ctx.db
              .query("readerLimits")
              .withIndex("by_userId_and_bucket", (q) =>
                q.eq("userId", f.readerLibraryId).eq("bucket", bucket),
              )
              .unique()
          )?.count,
      );
    const max = READER_LIMITS.alongsideRetrieval.max;
    for (let i = 0; i < max; i++) {
      await addHighlight(f, f.readerLibraryId);
      expect(
        await f.reader.mutation(api.alongside.requestAhead, {
          articleId: f.articleId,
          currentSection: 0,
        }),
      ).toBe("scheduled");
      const row = await rowFor(f, f.articleId, 1);
      // The pass ended without a model call
      await f.t.mutation(internal.alongside.settle, {
        userId: f.readerLibraryId,
        articleId: f.articleId,
        sectionIndex: 1,
        claim: row?.claim ?? 0,
        outcome: "skipped",
      });
    }
    expect(await limit("alongsideDaily")).toBe(0);
    expect(await limit("alongsideRetrieval")).toBe(max);
    await addHighlight(f, f.readerLibraryId);
    expect(
      await f.reader.mutation(api.alongside.requestAhead, {
        articleId: f.articleId,
        currentSection: 0,
      }),
    ).toBe("budget");
    expect(await passJobs(f)).toHaveLength(max);
    // The refused request kept nothing of the generation reservation either
    expect(await limit("alongsideDaily")).toBe(0);
  });
});

describe("the embedding stamp", () => {
  it("moves the fingerprint when anything becomes searchable or stops being", async () => {
    const f = await secondReaderTest(modules);
    const stamp = async () =>
      (await f.t.run((ctx) => computeFingerprint(ctx, f.readerLibraryId)))
        .embeddedMax;
    let last = await stamp();
    const moved = async (label: string) => {
      const next = await stamp();
      expect(next, label).toBeGreaterThan(last ?? 0);
      last = next;
    };
    const later = () => vi.setSystemTime(Date.now() + 1_000);

    later();
    const noteId = await addNote(f, f.readerLibraryId, false);
    await f.t.mutation(internal.userNotes.setEmbedding, {
      noteId,
      embedding: vector,
      contentPlain: "Remote teams need written culture.",
    });
    await moved("note embedding");

    later();
    const highlightId = await addHighlight(f, f.readerLibraryId);
    await f.t.mutation(internal.highlights.setEmbedding, {
      highlightId,
      embedding: vector,
    });
    await moved("highlight embedding");

    later();
    const threadId = await f.t.run(async (ctx) => {
      const article = await ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        guid: "th",
        url: "https://example.com/th",
        title: "T",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
      return ctx.db.insert("companionThreads", {
        userId: f.readerLibraryId,
        articleId: article,
        mode: "ask",
        selection: "x",
        turns: [{ role: "user", content: "Why?" }],
        createdAt: 5,
        updatedAt: 5,
      });
    });
    await f.t.mutation(internal.companionThreads.setEmbedding, {
      threadId,
      embedding: vector,
    });
    await moved("thread embedding");

    later();
    const articleId = await f.t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        guid: "e",
        url: "https://example.com/e",
        title: "E",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      }),
    );
    await f.t.mutation(internal.articles.setEmbedding, {
      articleId,
      embedding: vector,
    });
    await moved("library article embedding");

    // Editing a note removes its embedding, so the next visit re-checks
    later();
    await f.reader.mutation(api.userNotes.update, {
      noteId,
      content: "<p>x</p>",
      contentPlain: "x",
    });
    await moved("note edit");
  });

  it("moves the fingerprint for vault chunks through their own indexing time", async () => {
    const f = await secondReaderTest(modules);
    const chunk = {
      userId: f.readerLibraryId,
      filePath: "Vault/a.md",
      fileName: "a.md",
      chunkIndex: 0,
      content: "vault",
      embedding: vector,
      fileHash: "h",
      indexedAt: 9,
    };
    await f.t.mutation(internal.noteChunks.replaceFile, {
      userId: f.readerLibraryId,
      filePath: chunk.filePath,
      chunks: [chunk],
    });
    const first = await f.t.run((ctx) =>
      computeFingerprint(ctx, f.readerLibraryId),
    );
    await f.t.mutation(internal.noteChunks.insertBatch, {
      userId: f.readerLibraryId,
      chunks: [
        { ...chunk, filePath: "Vault/b.md", fileName: "b.md", indexedAt: 10 },
      ],
    });
    const second = await f.t.run((ctx) =>
      computeFingerprint(ctx, f.readerLibraryId),
    );
    expect(second.vaultIndexedMax).toBeGreaterThan(first.vaultIndexedMax);
  });

  it("writes only the row it stamps, so concurrent embeddings never contend", async () => {
    const f = await secondReaderTest(modules);
    const dump = async () =>
      new Map(
        await f.t.run(async (ctx) => {
          const rows = new Map<string, string>();
          for (const table of Object.keys(
            schema.tables,
          ) as (keyof typeof schema.tables)[])
            for (const row of await ctx.db.query(table).collect())
              rows.set(row._id, JSON.stringify(row));
          return [...rows.entries()];
        }),
      );
    const changed = async (write: () => Promise<unknown>) => {
      const before = await dump();
      await write();
      const after = await dump();
      return [...new Set([...before.keys(), ...after.keys()])].filter(
        (id) => before.get(id) !== after.get(id),
      );
    };
    const noteId = await addNote(f, f.readerLibraryId, false);
    const highlightId = await addHighlight(f, f.readerLibraryId);
    const threadId = await f.t.run(async (ctx) => {
      const article = await ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        guid: "th",
        url: "https://example.com/th",
        title: "T",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
      return ctx.db.insert("companionThreads", {
        userId: f.readerLibraryId,
        articleId: article,
        mode: "ask",
        selection: "x",
        turns: [{ role: "user", content: "Why?" }],
        createdAt: 5,
        updatedAt: 5,
      });
    });
    const articleId = await f.t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        guid: "e",
        url: "https://example.com/e",
        title: "E",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      }),
    );
    expect(
      await changed(() =>
        f.t.mutation(internal.userNotes.setEmbedding, {
          noteId,
          embedding: vector,
          contentPlain: "Remote teams need written culture.",
        }),
      ),
    ).toEqual([noteId]);
    expect(
      await changed(() =>
        f.t.mutation(internal.highlights.setEmbedding, {
          highlightId,
          embedding: vector,
        }),
      ),
    ).toEqual([highlightId]);
    expect(
      await changed(() =>
        f.t.mutation(internal.companionThreads.setEmbedding, {
          threadId,
          embedding: vector,
        }),
      ),
    ).toEqual([threadId]);
    expect(
      await changed(() =>
        f.t.mutation(internal.articles.setEmbedding, {
          articleId,
          embedding: vector,
        }),
      ),
    ).toEqual([articleId]);
  });

  it("is per reader, and compares equal to a fingerprint from before it existed", async () => {
    const f = await secondReaderTest(modules);
    const owner = await f.t.run((ctx) => computeFingerprint(ctx, OWNER));
    const noteId = await addNote(f, f.readerLibraryId, false);
    await f.t.mutation(internal.userNotes.setEmbedding, {
      noteId,
      embedding: vector,
      contentPlain: "Remote teams need written culture.",
    });
    const after = await f.t.run((ctx) => computeFingerprint(ctx, OWNER));
    expect(sameFingerprint(owner, after)).toBe(true);
    const { embeddedMax: _omit, ...older } = owner;
    expect(sameFingerprint(older, { ...owner, embeddedMax: 0 })).toBe(true);
  });
});
