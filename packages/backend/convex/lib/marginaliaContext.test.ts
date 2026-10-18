/// <reference types="vite/client" />

import { type FunctionReference, getFunctionName } from "convex/server";
import { getConvexSize, type Value } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveTestCredential } from "../../test/owner";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import schema from "../schema";
import { buildMarginaliaContext, splitIntoSections } from "./marginaliaContext";
import {
  clipRecallText,
  RECALL_CONTEXT_BYTES,
  textBytes,
} from "./marginaliaRecallBudget";

const modules = import.meta.glob("../**/*.ts");
const vector = Array.from({ length: 1536 }, () => 0.5);
const embedder = { provider: "openai", apiKey: "fixture-no-live-key" } as const;
const readerId = "recall-reader";
type SearchRows = { _id: string; _score: number }[];
type Search = (
  table: string,
  vector: number[],
  call: number,
) => Promise<SearchRows>;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = convexTest({
    schema,
    modules,
    transactionLimits: { bytesRead: 4 * 1024 * 1024 },
  });
  const reader = await t.run((ctx) =>
    ctx.db.insert("readers", {
      authId: "fixture-auth",
      libraryId: readerId,
      status: "active",
      createdAt: 1,
    }),
  );
  async function addArticle(
    title: string,
    extra: Partial<Doc<"articles">> = {},
  ) {
    return t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: readerId,
        guid: title,
        title,
        url: `https://example.com/${title}`,
        content: "A claim deserves evidence. ".repeat(80),
        excerpt: `Excerpt ${title}`,
        estimatedReadMinutes: 4,
        embedding: vector,
        extractionStatus: "extracted",
        annotationStatus: "pending",
        wordCount: 800,
        createdAt: 1,
        ...extra,
      }),
    );
  }
  const target = await addArticle("Target");
  const parent = await addArticle("Related");
  async function article(id = target) {
    const result = await t.run((ctx) => ctx.db.get("articles", id));
    if (!result?.content) throw new Error("Invalid fixture");
    return { ...result, content: result.content };
  }
  const requests: string[][] = [];
  function mockEmbeddings() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const input: string[] = JSON.parse(String(init.body)).input;
        requests.push(input);
        return Response.json({
          data: input.map((_, index) => ({ index, embedding: vector })),
        });
      }),
    );
  }
  const queries: { name: string; args: Record<string, Value> }[] = [];
  function action(search: Search = async () => []) {
    let call = 0;
    // A fixture only implements the two action capabilities recall uses.
    // SAFETY: the real Convex query boundary still validates every argument;
    // vector results deliberately include stale/foreign IDs in adversarial tests.
    return {
      runQuery: async (
        ref: FunctionReference<"query", "internal">,
        args: Record<string, Value>,
      ) => {
        queries.push({ name: getFunctionName(ref), args });
        return t.query(ref, args);
      },
      vectorSearch: async (
        table: string,
        _index: string,
        options: { vector: number[] },
      ) => search(table, options.vector, call++),
    } as Pick<ActionCtx, "runQuery" | "vectorSearch">;
  }
  async function sources(large = "") {
    return t.run(async (ctx) => ({
      chunk: await ctx.db.insert("noteChunks", {
        userId: readerId,
        filePath: "Reading/Evidence.md",
        fileName: "Evidence",
        chunkIndex: 0,
        content: large || "Vault evidence challenges the claim.",
        embedding: vector,
        fileHash: "hash",
        indexedAt: 11,
      }),
      note: await ctx.db.insert("userNotes", {
        userId: readerId,
        articleId: parent,
        selectedText: "A claim",
        prompt: "What would disprove this?",
        content: "<p>Reflection</p>",
        contentPlain: large || "My reflection questions the sample.",
        embedding: vector,
        createdAt: 12,
        updatedAt: 13,
      }),
      highlight: await ctx.db.insert("highlights", {
        userId: readerId,
        articleId: parent,
        kind: "underline",
        text: large || "A counterexample from the reader.",
        embedding: vector,
        createdAt: 14,
      }),
      thread: await ctx.db.insert("companionThreads", {
        userId: readerId,
        articleId: parent,
        mode: "ask",
        selection: "The premise",
        question: "Does this follow?",
        turns: [
          { role: "user", content: large || "What if selection is biased?" },
          {
            role: "assistant",
            content:
              "The sampling frame excludes counterexamples.\n\nMore detail.",
          },
        ],
        embedding: vector,
        createdAt: 15,
        updatedAt: 16,
      }),
    }));
  }
  return {
    t,
    reader,
    target,
    parent,
    article,
    addArticle,
    requests,
    mockEmbeddings,
    queries,
    action,
    sources,
  };
}

describe("splitIntoSections", () => {
  it("keeps a short article in one section", () => {
    expect(
      splitIntoSections("A short piece. With two sentences."),
    ).toHaveLength(1);
  });

  it("caps long articles at 12 sections and keeps every sentence", () => {
    const text = Array.from(
      { length: 2000 },
      (_, i) => `Sentence number ${i}.`,
    ).join(" ");
    const sections = splitIntoSections(text);
    expect(sections.length).toBeLessThanOrEqual(12);
    expect(sections.length).toBeGreaterThan(1);
    const rejoined = sections.join(" ");
    expect(rejoined).toContain("Sentence number 0.");
    expect(rejoined).toContain("Sentence number 1999.");
  });

  it("cuts at sentence boundaries", () => {
    const text = Array.from(
      { length: 800 },
      (_, i) => `Claim ${i} holds.`,
    ).join(" ");
    for (const section of splitIntoSections(text).slice(0, -1)) {
      expect(section.endsWith(".")).toBe(true);
    }
  });
});

describe("bounded private marginalia recall", () => {
  it("overlaps sixty searches in ONE four-slot pool and merges out-of-order results deterministically", async () => {
    const f = await fixture();
    const ids = await f.sources();
    const secondChunk = await f.t.run((ctx) =>
      ctx.db.insert("noteChunks", {
        userId: readerId,
        filePath: "Reading/Other.md",
        fileName: "Other",
        chunkIndex: 0,
        content: "A second source.",
        embedding: vector,
        fileHash: "hash",
        indexedAt: 20,
      }),
    );
    const text = Array.from(
      { length: 12 },
      (_, i) =>
        `Opening number ${i} about evidence. ${"Relevant words ".repeat(340)}\n`,
    ).join("");
    expect(splitIntoSections(text)).toHaveLength(12);
    await f.t.run((ctx) =>
      ctx.db.patch("articles", f.target, { content: text }),
    );
    f.mockEmbeddings();
    async function run(reverse: boolean) {
      let active = 0;
      let peak = 0;
      const called: string[] = [];
      const completed: number[] = [];
      const ctx = f.action(async (table, _vector, call) => {
        active++;
        peak = Math.max(peak, active);
        called.push(table);
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            reverse ? (4 - (call % 4)) * 2 : ((call % 4) + 1) * 2,
          ),
        );
        active--;
        completed.push(call);
        if (table === "noteChunks") {
          if (call === 0)
            return [
              { _id: ids.chunk, _score: 0.6 },
              { _id: secondChunk, _score: 0.59 },
            ];
          if (call === 1)
            return [
              { _id: secondChunk, _score: 0.9 },
              { _id: ids.chunk, _score: 0.7 },
            ];
          return [];
        }
        const id = new Map<string, string>([
          ["articles", f.parent],
          ["userNotes", ids.note],
          ["highlights", ids.highlight],
          ["companionThreads", ids.thread],
        ]).get(table);
        return id ? [{ _id: id, _score: 0.8 }] : [];
      });
      const result = await buildMarginaliaContext(
        ctx,
        await f.article(),
        embedder,
      );
      expect(peak).toBe(4);
      expect(called).toHaveLength(60);
      for (const table of [
        "noteChunks",
        "articles",
        "userNotes",
        "highlights",
        "companionThreads",
      ])
        expect(called.filter((value) => value === table)).toHaveLength(12);
      if (reverse) expect(completed.slice(0, 4)).not.toEqual([0, 1, 2, 3]);
      return result;
    }
    const first = await run(true);
    const second = await run(false);
    expect(second).toEqual(first);
    expect(first.sources).toEqual([
      `chunk:${secondChunk}:20`,
      `chunk:${ids.chunk}:11`,
      `article:${f.parent}:d97e8372`,
      `note:${ids.note}:13`,
      `highlight:${ids.highlight}:14`,
      `thread:${ids.thread}:16`,
    ]);
    expect(first.contextText).toContain("similarity 0.90");
    expect(first.contextText).toContain("Opening number 0");
    expect(first.contextText).toContain("Opening number 1");
    expect(first.vaultPaths).toEqual([
      "Reading/Other.md",
      "Reading/Evidence.md",
    ]);
    expect(first.contextText).not.toContain("Recall limits");
    // One parent lookup per request serves the candidate + notes + marks + questions.
    expect(
      f.queries.filter(
        (query) =>
          query.name === "marginaliaRecall:article" &&
          query.args.articleId === f.parent,
      ),
    ).toHaveLength(2);
  });

  it("deduplicates exact section embedding inputs without another provider batch", async () => {
    const f = await fixture();
    const text = "x ".repeat(24_000);
    expect(splitIntoSections(text)).toHaveLength(12);
    await f.t.run((ctx) =>
      ctx.db.patch("articles", f.target, { content: text }),
    );
    f.mockEmbeddings();
    const seen: number[][] = [];
    await buildMarginaliaContext(
      f.action(async (_table, value) => {
        seen.push(value);
        return [];
      }),
      await f.article(),
      embedder,
    );
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toHaveLength(1);
    expect(seen).toHaveLength(60);
    expect(
      seen.every((value) => value.length === 1536 && value[0] === 0.5),
    ).toBe(true);
  });

  it("joins in-flight searches on failure and never hydrates a partial recall", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.patch("articles", f.target, { content: "word ".repeat(12_000) }),
    );
    f.mockEmbeddings();
    let active = 0;
    let calls = 0;
    const ctx = f.action(async (_table, _vector, call) => {
      calls++;
      if (call === 0) throw new Error("Fixture search failure");
      active++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return [];
    });
    await expect(
      buildMarginaliaContext(ctx, await f.article(), embedder),
    ).rejects.toThrow("Fixture search failure");
    expect(active).toBe(0);
    expect(calls).toBe(4);
    expect(f.queries.map((query) => query.name)).toEqual([
      "marginaliaRecall:authorize",
    ]);
  });

  it("keeps score floors, two chunks per vault path, five activity items and six library candidates", async () => {
    const f = await fixture();
    const chunks = await f.t.run(async (ctx) =>
      Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          ctx.db.insert("noteChunks", {
            userId: readerId,
            filePath: i < 3 ? "Same.md" : "Low.md",
            fileName: "Same",
            chunkIndex: i,
            content: `Chunk ${i}`,
            embedding: vector,
            fileHash: "hash",
            indexedAt: i,
          }),
        ),
      ),
    );
    const notes = await f.t.run(async (ctx) =>
      Promise.all(
        Array.from({ length: 7 }, (_, i) =>
          ctx.db.insert("userNotes", {
            userId: readerId,
            articleId: f.parent,
            selectedText: "",
            content: "",
            contentPlain: `Note ${i}`,
            embedding: vector,
            createdAt: i,
            updatedAt: i,
          }),
        ),
      ),
    );
    const articles: Id<"articles">[] = [];
    for (let i = 0; i < 8; i++)
      articles.push(await f.addArticle(`Candidate ${i}`));
    f.mockEmbeddings();
    const result = await buildMarginaliaContext(
      f.action(async (table) =>
        table === "noteChunks"
          ? chunks.map((_id, i) => ({
              _id,
              _score: i === 3 ? 0.499 : 0.8 - i * 0.01,
            }))
          : table === "userNotes"
            ? notes.map((_id, i) => ({
                _id,
                _score: i === 6 ? 0.449 : 0.8 - i * 0.01,
              }))
            : table === "articles"
              ? articles.map((_id, i) => ({ _id, _score: 0.8 - i * 0.01 }))
              : [],
      ),
      await f.article(),
      embedder,
    );
    expect(
      result.sources.filter((key) => key.startsWith("chunk:")),
    ).toHaveLength(2);
    expect(
      result.sources.filter((key) => key.startsWith("note:")),
    ).toHaveLength(5);
    expect(result.libraryCandidates.map((item) => item.id)).toEqual(
      articles.slice(0, 6),
    );
    expect(result.contextText).not.toContain("Chunk 2");
    expect(result.contextText).not.toContain("Low.md");
    expect(result.contextText).not.toContain("Note 5");
  });

  it("bounds near-limit multilingual source/title transactions and spends context by relevance, not family order", async () => {
    const f = await fixture();
    const huge = "界🙂".repeat(130_000); // 910,000 UTF-8 bytes, not 390,000.
    const ids = await f.sources(huge);
    const chunks = await f.t.run(async (ctx) =>
      Promise.all(
        Array.from({ length: 7 }, (_, i) =>
          ctx.db.insert("noteChunks", {
            userId: readerId,
            filePath: `Low-${i}.md`,
            fileName: "Low",
            chunkIndex: 0,
            content: `LOW-${i} ${huge}`,
            embedding: vector,
            fileHash: "hash",
            indexedAt: i,
          }),
        ),
      ),
    );
    // Four near-limit article/title joins would consume most/all of a 4 MiB
    // transaction, before the near-limit note bodies. Each is fetched separately.
    const parents: Id<"articles">[] = [f.parent];
    await f.t.run((ctx) =>
      ctx.db.patch("articles", f.parent, { content: huge }),
    );
    for (let i = 0; i < 3; i++)
      parents.push(await f.addArticle(`Huge ${i}`, { content: huge }));
    const notes = await f.t.run(async (ctx) =>
      Promise.all(
        parents.map((articleId, i) =>
          ctx.db.insert("userNotes", {
            userId: readerId,
            articleId,
            selectedText: "Context",
            content: "",
            contentPlain: `HIGH-NOTE-${i} ${huge}`,
            embedding: vector,
            createdAt: i,
            updatedAt: i,
          }),
        ),
      ),
    );
    f.mockEmbeddings();
    const result = await buildMarginaliaContext(
      f.action(async (table) =>
        table === "noteChunks"
          ? chunks.map((_id) => ({ _id, _score: 0.51 }))
          : table === "userNotes"
            ? notes.map((_id) => ({ _id, _score: 0.95 }))
            : table === "companionThreads"
              ? [{ _id: ids.thread, _score: 0.99 }]
              : table === "articles"
                ? parents.map((_id) => ({ _id, _score: 0.85 }))
                : [],
      ),
      await f.article(),
      embedder,
    );
    expect(textBytes(result.contextText)).toBeLessThanOrEqual(
      RECALL_CONTEXT_BYTES,
    );
    expect(result.contextText).toContain("[Context clipped]");
    expect(result.contextText).toContain(
      "candidate sources omitted by relevance/size",
    );
    expect(result.contextText).toContain(
      "Answer began: The sampling frame excludes counterexamples.",
    );
    expect(result.sources).toContain(`thread:${ids.thread}:16`);
    for (const id of notes)
      expect(result.sources.some((key) => key.startsWith(`note:${id}:`))).toBe(
        true,
      );
    expect(
      result.sources.filter((key) => key.startsWith("chunk:")).length,
    ).toBeLessThan(7);
    const hydrated = await f.t.query(internal.marginaliaRecall.hydrate, {
      userId: readerId,
      refs: [
        { kind: "note", id: notes[0] },
        { kind: "thread", id: ids.thread },
      ],
    });
    expect(getConvexSize(hydrated)).toBeLessThanOrEqual(32 * 1024);
    expect(
      hydrated.every(
        (item) =>
          !Object.hasOwn(item, "embedding") &&
          !Object.hasOwn(item, "turns") &&
          !Object.hasOwn(item, "content"),
      ),
    ).toBe(true);
    await expect(
      f.t.query(internal.marginaliaRecall.hydrate, {
        userId: readerId,
        refs: [
          { kind: "note", id: notes[0] },
          { kind: "thread", id: ids.thread },
          { kind: "chunk", id: ids.chunk },
        ],
      }),
    ).rejects.toThrow("batch too large");
  });

  it("bounds same-article history before transport, including empty pages, and preserves selected source versions", async () => {
    const f = await fixture();
    const huge = "界🙂".repeat(130_000);
    const own = await f.t.run(async (ctx) =>
      Promise.all(
        Array.from({ length: 14 }, (_, i) =>
          ctx.db.insert("userNotes", {
            userId: readerId,
            articleId: f.target,
            selectedText: "Current paragraph",
            content: "",
            contentPlain: `Own ${i} ${huge}`,
            createdAt: i,
            updatedAt: 100 + i,
          }),
        ),
      ),
    );
    const first = await f.t.query(internal.marginaliaRecall.ownNotes, {
      userId: readerId,
      articleId: f.target,
      cursor: null,
      limit: 10,
    });
    expect(first.isDone).toBe(false);
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.length).toBeLessThan(10);
    expect(getConvexSize(first)).toBeLessThan(160 * 1024);
    const related = await f.sources(huge);
    f.mockEmbeddings();
    const result = await buildMarginaliaContext(
      f.action(async (table) =>
        table === "noteChunks" ? [{ _id: related.chunk, _score: 0.5 }] : [],
      ),
      await f.article(),
      embedder,
    );
    expect(textBytes(result.contextText)).toBeLessThanOrEqual(
      RECALL_CONTEXT_BYTES,
    );
    expect(result.contextText).toContain("Current paragraph");
    expect(result.contextText).toContain("Additional activity");
    expect(result.contextText).toContain("Related vault context omitted");
    expect(result.contextText).not.toContain("None are closely related");
    expect(result.vaultPaths).toEqual([]);
    expect(
      result.sources.every((key) =>
        own.slice(0, 10).some((id, i) => key === `note:${id}:${100 + i}`),
      ),
    ).toBe(true);
    expect(
      f.queries.every((query) => query.name.startsWith("marginaliaRecall:")),
    ).toBe(true);
    // Empty highlight/thread pages are independent queries, not second paginate
    // calls hidden in the notes query's transaction.
    expect(
      f.queries.some(
        (query) => query.name === "marginaliaRecall:ownHighlights",
      ),
    ).toBe(true);
    expect(
      f.queries.some((query) => query.name === "marginaliaRecall:ownThreads"),
    ).toBe(true);
  });

  it.each([
    "disabled",
    "deleting",
    "gone",
    "foreign article",
    "deleted article",
  ])("rejects %s before embedding/search", async (state) => {
    const f = await fixture();
    const current = await f.article();
    await f.t.run(async (ctx) => {
      if (state === "gone") await ctx.db.delete("readers", f.reader);
      else if (state === "deleted article")
        await ctx.db.delete("articles", f.target);
      else if (state === "foreign article")
        await ctx.db.patch("articles", f.target, { userId: "another-library" });
      else
        await ctx.db.patch(
          "readers",
          f.reader,
          state === "disabled" ? { status: "disabled" } : { deletingAt: 1 },
        );
    });
    f.mockEmbeddings();
    const search = vi.fn(async () => []);
    await expect(
      buildMarginaliaContext(f.action(search), current, embedder),
    ).rejects.toThrow("no longer available");
    expect(f.requests).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("drops stale IDs, foreign source rows and foreign/deleted parents, and rechecks revocation after searches", async () => {
    const f = await fixture();
    const ids = await f.sources();
    const foreign = await f.addArticle("FOREIGN SECRET", { userId: "other" });
    const deleted = await f.addArticle("DELETED SECRET");
    const notes = await f.t.run(async (ctx) => {
      const insert = (articleId: Id<"articles">, userId = readerId) =>
        ctx.db.insert("userNotes", {
          userId,
          articleId,
          selectedText: "",
          content: "",
          contentPlain: "PRIVATE SECRET",
          embedding: vector,
          createdAt: 1,
          updatedAt: 1,
        });
      const rows = [
        await insert(foreign),
        await insert(deleted),
        await insert(f.parent, "other"),
        await insert(f.parent),
      ];
      await ctx.db.delete("articles", deleted);
      await ctx.db.delete("userNotes", rows[3]);
      return rows;
    });
    f.mockEmbeddings();
    const result = await buildMarginaliaContext(
      f.action(async (table) =>
        table === "userNotes" ? notes.map((_id) => ({ _id, _score: 0.9 })) : [],
      ),
      await f.article(),
      embedder,
    );
    expect(result.contextText).not.toContain("SECRET");
    expect(result.sources).toEqual([]);
    expect(
      await f.t.query(internal.marginaliaRecall.ownNotes, {
        userId: readerId,
        articleId: foreign,
        cursor: null,
        limit: 10,
      }),
    ).toMatchObject({ items: [], isDone: true });
    let revoked = false;
    await expect(
      buildMarginaliaContext(
        f.action(async (table) => {
          if (!revoked) {
            revoked = true;
            await f.t.run((ctx) =>
              ctx.db.patch("readers", f.reader, { deletingAt: 1 }),
            );
          }
          return table === "userNotes" ? [{ _id: ids.note, _score: 0.9 }] : [];
        }),
        await f.article(),
        embedder,
      ),
    ).rejects.toThrow("no longer available");
    expect(
      await f.t.query(internal.marginaliaRecall.hydrate, {
        userId: readerId,
        refs: [{ kind: "note", id: ids.note }],
      }),
    ).toEqual([]);
  });

  it("clips multilingual text on code-point boundaries and leaves ordinary text byte-for-byte alone", () => {
    expect(clipRecallText("ordinary text", 1024)).toBe("ordinary text");
    const clipped = clipRecallText("界🙂".repeat(1000), 1024);
    expect(textBytes(clipped)).toBeLessThanOrEqual(1024);
    expect(clipped).not.toContain("�");
    expect(clipped).toContain("[Context clipped]");
  });

  it("filters forged same-article activity rows and bounds every family's ordinary history", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 14; i++) {
        const userId = i === 0 ? "foreign-reader" : readerId;
        await ctx.db.insert("userNotes", {
          userId,
          articleId: f.target,
          selectedText: "A claim",
          content: "",
          contentPlain: i === 0 ? "FOREIGN SECRET" : `Own note ${i}`,
          createdAt: i,
          updatedAt: i,
        });
        await ctx.db.insert("highlights", {
          userId,
          articleId: f.target,
          kind: "underline",
          text: i === 0 ? "FOREIGN SECRET" : `Own mark ${i}`,
          createdAt: i,
        });
        await ctx.db.insert("companionThreads", {
          userId,
          articleId: f.target,
          mode: "explain",
          selection: i === 0 ? "FOREIGN SECRET" : `Own question ${i}`,
          turns: [{ role: "assistant", content: "A thoughtful explanation." }],
          createdAt: i,
          updatedAt: i,
        });
      }
    });
    const result = await buildMarginaliaContext(
      f.action(),
      await f.article(),
      null,
    );
    expect(
      result.sources.filter((source) => source.startsWith("note:")),
    ).toHaveLength(10);
    expect(
      result.sources.filter((source) => source.startsWith("highlight:")),
    ).toHaveLength(10);
    expect(
      result.sources.filter((source) => source.startsWith("thread:")),
    ).toHaveLength(8);
    expect(result.contextText).not.toContain("FOREIGN SECRET");
    expect(result.contextText).toContain("Underlined");
    expect(result.contextText).toContain("Own note 10");
    expect(result.contextText).not.toContain("Own note 11");
    expect(result.contextText).toContain("Own question 8");
    expect(result.contextText).not.toContain("Own question 9");
    await expect(
      f.t.query(internal.marginaliaRecall.ownNotes, {
        userId: readerId,
        articleId: f.target,
        cursor: null,
        limit: 11,
      }),
    ).rejects.toThrow("activity limit");
    await expect(
      f.t.query(internal.marginaliaRecall.ownThreads, {
        userId: readerId,
        articleId: f.target,
        cursor: null,
        limit: 9,
      }),
    ).rejects.toThrow("activity limit");
  });

  it("feeds the actual annotation consumer substantive context and retains anchored library/vault citations", async () => {
    const f = await fixture();
    const ids = await f.sources();
    await saveTestCredential(f.t, readerId, "openrouter", "sk-or-fixture-0001");
    const content =
      "A claim deserves evidence. A second claim is testable. A conclusion needs a comparison. ".repeat(
        30,
      );
    await f.t.run((ctx) => ctx.db.patch("articles", f.target, { content }));
    const substantive =
      "The comparison excludes teams that stopped reporting, so the apparent gain could reflect selection rather than improvement. Checking the missing teams would distinguish those explanations.";
    const reflection = {
      strongestPoint: "The claim is testable.",
      weakestAssumption: "The sample is representative.",
      credibleCounterview: "Selection explains the gain.",
      questionForYou: "Which missing observation would change your mind?",
    };
    const prompts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body));
        if (url.endsWith("/embeddings"))
          return Response.json({
            data: request.input.map((_: string, index: number) => ({
              index,
              embedding: vector,
            })),
          });
        const prompt = JSON.stringify(request.messages);
        prompts.push(prompt);
        expect(prompt).toContain("two to four sentences");
        expect(prompt).toContain("Vault evidence challenges the claim.");
        expect(prompt).toContain("My reflection questions the sample.");
        expect(prompt).toContain(
          "The sampling frame excludes counterexamples.",
        );
        return Response.json({
          id: "fixture",
          created: 1,
          model: request.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  annotations: [
                    {
                      type: "cross_reference",
                      articleRefId: f.parent,
                      anchorText: "A claim deserves evidence.",
                      content: substantive,
                      relevanceScore: 0.95,
                      reasoning:
                        "A specific comparison to the recalled article.",
                    },
                    {
                      type: "cross_reference",
                      notePath: "Reading/Evidence.md",
                      noteExcerpt: "Vault evidence challenges the claim.",
                      anchorText: "A second claim is testable.",
                      content: substantive,
                      relevanceScore: 0.9,
                      reasoning: "The vault note provides a counterexample.",
                    },
                    {
                      type: "unsupported",
                      anchorText: "A conclusion needs a comparison.",
                      content: substantive,
                      relevanceScore: 0.85,
                      reasoning: "The denominator is missing.",
                    },
                  ],
                  reflection,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }),
    );
    await f.t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: f.target,
    });
    const notes = await f.t.run((ctx) =>
      ctx.db
        .query("annotations")
        .withIndex("by_article", (q) => q.eq("articleId", f.target))
        .collect(),
    );
    expect(prompts).toHaveLength(1);
    expect(notes).toHaveLength(3);
    expect(
      notes.every(
        (note) =>
          note.content === substantive &&
          content.slice(note.anchorStartOffset, note.anchorEndOffset) ===
            note.anchorText,
      ),
    ).toBe(true);
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          articleRefId: f.parent,
          type: "cross_reference",
        }),
        expect.objectContaining({
          notePath: "Reading/Evidence.md",
          noteExcerpt: "Vault evidence challenges the claim.",
        }),
        expect.objectContaining({ type: "unsupported" }),
      ]),
    );
    const stored = await f.article();
    expect(stored.marginaliaSources).toEqual(
      expect.arrayContaining([
        `chunk:${ids.chunk}:11`,
        `note:${ids.note}:13`,
        `highlight:${ids.highlight}:14`,
        `thread:${ids.thread}:16`,
      ]),
    );
  });
});
