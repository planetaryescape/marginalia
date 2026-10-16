/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerWithKey, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { MAX_NODES, nodeKey } from "./lib/ideaGraph";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

let tick = 1_000;
function addArticle(ctx: MutationCtx, userId: string, title: string) {
  return ctx.db.insert("articles", {
    userId,
    guid: title,
    url: `https://example.com/${title.replace(/\s/g, "-")}`,
    title,
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    createdAt: Date.now(),
  });
}
function addNote(
  ctx: MutationCtx,
  userId: string,
  articleId: Id<"articles">,
  text: string,
) {
  tick += 1;
  return ctx.db.insert("userNotes", {
    userId,
    articleId,
    selectedText: "",
    content: `<p>${text}</p>`,
    contentPlain: text,
    createdAt: tick,
    updatedAt: tick,
  });
}
function addMark(
  ctx: MutationCtx,
  userId: string,
  articleId: Id<"articles">,
  text: string,
) {
  return ctx.db.insert("highlights", {
    userId,
    articleId,
    kind: "highlight",
    text,
    createdAt: Date.now(),
  });
}
function addVault(ctx: MutationCtx, userId: string, name: string) {
  return ctx.db.insert("noteChunks", {
    userId,
    filePath: `vault/${name}.md`,
    fileName: `${name}.md`,
    chunkIndex: 0,
    content: `Vault text about ${name}`,
    embedding: [1, 0],
    fileHash: name,
    indexedAt: Date.now(),
  });
}
function addTag(
  ctx: MutationCtx,
  userId: string,
  name: string,
  articleIds: Id<"articles">[],
  status: "active" | "candidate" = "active",
) {
  return (async () => {
    const tagId = await ctx.db.insert("tags", {
      userId,
      name,
      key: name,
      status,
      count: articleIds.length,
      aliases: [],
      createdAt: Date.now(),
    });
    for (const articleId of articleIds)
      await ctx.db.insert("articleTags", {
        userId,
        articleId,
        tagId,
        createdAt: Date.now(),
      });
  })();
}

const reasonsOf = (
  g: {
    edges: {
      a: string;
      b: string;
      reasons: { type: string; text: string }[];
    }[];
  },
  key: string,
) =>
  g.edges
    .filter((e) => e.a === key || e.b === key)
    .flatMap((e) => e.reasons.map((r) => r.type));

describe("idea graph edges", () => {
  it("is empty without notes and centres on the latest note by default", async () => {
    const { t, owner } = await secondReaderTest(modules);
    expect(await owner.query(api.ideaGraph.graph, {})).toEqual({
      centre: null,
      nodes: [],
      edges: [],
    });
    const [older, newer] = await t.run(async (ctx) => {
      const article = await addArticle(ctx, OWNER, "Alpha");
      return [
        await addNote(ctx, OWNER, article, "older"),
        await addNote(ctx, OWNER, article, "newer"),
      ];
    });
    const g = await owner.query(api.ideaGraph.graph, {});
    expect(g.centre).toBe(nodeKey("note", newer));
    expect(g.nodes.map((n) => n.key)).toContain(nodeKey("note", older));
  });

  it("joins ideas on the same article and says so", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const article = await addArticle(ctx, OWNER, "Alpha");
      return {
        note: await addNote(ctx, OWNER, article, "centre"),
        mark: await addMark(ctx, OWNER, article, "a quoted line"),
      };
    });
    const g = await owner.query(api.ideaGraph.graph, {});
    const edge = g.edges.find((e) => e.b === nodeKey("highlight", ids.mark));
    expect(edge?.reasons[0].text).toBe("Same article: Alpha");
    expect(edge?.needsAi).toBe(false);
  });

  it("joins ideas on different articles that share an active tag, not a candidate one", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const one = await addArticle(ctx, OWNER, "One");
      const two = await addArticle(ctx, OWNER, "Two");
      await addTag(ctx, OWNER, "focus", [one, two]);
      await addTag(ctx, OWNER, "maybe", [one, two], "candidate");
      const other = await addNote(ctx, OWNER, two, "elsewhere");
      const centre = await addNote(ctx, OWNER, one, "centre");
      return { other, centre };
    });
    const g = await owner.query(api.ideaGraph.graph, {});
    expect(g.centre).toBe(nodeKey("note", ids.centre));
    const edge = g.edges.find((e) => e.b === nodeKey("note", ids.other));
    expect(edge?.reasons.map((r) => r.text)).toEqual(["Shared tag: focus"]);
  });

  it("joins an article to the vault note Marginalia connected it to, from either side", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const article = await addArticle(ctx, OWNER, "Alpha");
      const vault = await addVault(ctx, OWNER, "Deep work");
      await ctx.db.insert("annotations", {
        articleId: article,
        userId: OWNER,
        type: "cross_reference",
        noteChunkId: vault,
        anchorText: "x",
        anchorStartOffset: 0,
        anchorEndOffset: 1,
        content: "ties in",
        relevanceScore: 0.9,
        wasViewed: false,
        wasDismissed: false,
        createdAt: Date.now(),
      });
      const note = await addNote(ctx, OWNER, article, "centre");
      return { vault, note };
    });
    const vaultKey = nodeKey("vault", ids.vault);
    const fromNote = await owner.query(api.ideaGraph.graph, {});
    expect(reasonsOf(fromNote, vaultKey)).toContain("connection");

    // Opened from the vault side, the article's ideas come back
    const fromVault = await owner.query(api.ideaGraph.graph, {
      centre: vaultKey,
    });
    expect(fromVault.nodes.map((n) => n.key)).toContain(
      nodeKey("note", ids.note),
    );
    expect(reasonsOf(fromVault, nodeKey("note", ids.note))).toContain(
      "connection",
    );
  });

  it("uses embedding neighbours as hints, marks them for a generated reason, and drops anyone else's", async () => {
    const { t, owner, readerLibraryId } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const one = await addArticle(ctx, OWNER, "One");
      const two = await addArticle(ctx, OWNER, "Two");
      const theirs = await addArticle(ctx, readerLibraryId, "Theirs");
      return {
        far: await addNote(ctx, OWNER, two, "far away"),
        theirNote: await addNote(ctx, readerLibraryId, theirs, "private"),
        centre: await addNote(ctx, OWNER, one, "centre"),
      };
    });
    const g = await owner.query(api.ideaGraph.graph, {
      similar: [
        nodeKey("note", ids.far),
        nodeKey("note", ids.theirNote),
        "nonsense",
      ],
    });
    const edge = g.edges.find((e) => e.b === nodeKey("note", ids.far));
    expect(edge).toMatchObject({
      needsAi: true,
      reasons: [{ type: "similar" }],
    });
    expect(g.nodes.map((n) => n.key)).not.toContain(
      nodeKey("note", ids.theirNote),
    );
  });

  it("ranks a link the reader drew above everything else", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const one = await addArticle(ctx, OWNER, "One");
      const two = await addArticle(ctx, OWNER, "Two");
      const far = await addNote(ctx, OWNER, two, "far away");
      for (let i = 0; i < 9; i++) await addNote(ctx, OWNER, one, `near ${i}`);
      const centre = await addNote(ctx, OWNER, one, "centre");
      return { far, centre };
    });
    await owner.mutation(api.ideaGraph.link, {
      from: nodeKey("note", ids.centre),
      to: nodeKey("note", ids.far),
    });
    const g = await owner.query(api.ideaGraph.graph, {});
    const first = g.nodes.filter((n) => n.hop === 1);
    expect(first).toHaveLength(7);
    const edge = g.edges.find((e) => e.b === nodeKey("note", ids.far));
    expect(edge?.reasons[0].text).toBe("You linked these");
  });

  it("never shows more than the node cap, however much is nearby", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      const articles: Id<"articles">[] = [];
      for (let i = 0; i < 6; i++)
        articles.push(await addArticle(ctx, OWNER, `Article ${i}`));
      await addTag(ctx, OWNER, "shared", articles);
      for (const article of articles)
        for (let i = 0; i < 8; i++) {
          await addNote(ctx, OWNER, article, `note ${i}`);
          await addMark(ctx, OWNER, article, `mark ${i}`);
        }
    });
    const g = await owner.query(api.ideaGraph.graph, {});
    expect(g.nodes.length).toBeLessThanOrEqual(MAX_NODES);
    expect(g.nodes.length).toBe(MAX_NODES);
    const keys = new Set(g.nodes.map((n) => n.key));
    for (const e of g.edges) {
      expect(keys.has(e.a)).toBe(true);
      expect(keys.has(e.b)).toBe(true);
    }
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(g.edges.length);
  });

  it("shows several chunks of one vault file as one idea", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      const article = await addArticle(ctx, OWNER, "Alpha");
      const first = await addVault(ctx, OWNER, "Deep work");
      await ctx.db.insert("noteChunks", {
        userId: OWNER,
        filePath: "vault/Deep work.md",
        fileName: "Deep work.md",
        chunkIndex: 1,
        content: "More",
        embedding: [1, 0],
        fileHash: "x",
        indexedAt: Date.now(),
      });
      await addNote(ctx, OWNER, article, "centre");
      void first;
    });
    const g = await owner.query(api.ideaGraph.graph, {
      similar: (await t.run((ctx) => ctx.db.query("noteChunks").collect())).map(
        (c) => nodeKey("vault", c._id),
      ),
    });
    expect(g.nodes.filter((n) => n.kind === "vault")).toHaveLength(1);
  });

  it("keeps readers apart", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const mine = await addArticle(ctx, OWNER, "Mine");
      const theirs = await addArticle(ctx, readerLibraryId, "Theirs");
      return {
        mine: await addNote(ctx, OWNER, mine, "owner note"),
        theirs: await addNote(ctx, readerLibraryId, theirs, "reader note"),
        theirMark: await addMark(ctx, readerLibraryId, theirs, "reader mark"),
      };
    });
    const ownerGraph = await owner.query(api.ideaGraph.graph, {
      centre: nodeKey("note", ids.theirs),
    });
    // A foreign centre falls back to the owner's own latest note
    expect(ownerGraph.centre).toBe(nodeKey("note", ids.mine));
    expect(ownerGraph.nodes).toHaveLength(1);

    const readerGraph = await reader.query(api.ideaGraph.graph, {});
    expect(readerGraph.centre).toBe(nodeKey("note", ids.theirs));
    expect(readerGraph.nodes.map((n) => n.key)).toContain(
      nodeKey("highlight", ids.theirMark),
    );
    expect(readerGraph.nodes.map((n) => n.key)).not.toContain(
      nodeKey("note", ids.mine),
    );
    expect(
      await owner.query(api.ideaGraph.node, {
        key: nodeKey("note", ids.theirs),
      }),
    ).toBeNull();
    expect(
      await owner.query(api.ideaGraph.search, { query: "reader" }),
    ).toEqual([]);
  });

  it("opens one idea in full, and says whether a note can be written beside it", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => ({
      note: await addNote(
        ctx,
        OWNER,
        await addArticle(ctx, OWNER, "Alpha"),
        "protect whole mornings",
      ),
      vault: await addVault(ctx, OWNER, "Loose"),
    }));
    expect(
      await owner.query(api.ideaGraph.node, { key: nodeKey("note", ids.note) }),
    ).toMatchObject({
      text: "protect whole mornings",
      articleTitle: "Alpha",
      canWrite: true,
    });
    expect(
      await owner.query(api.ideaGraph.node, {
        key: nodeKey("vault", ids.vault),
      }),
    ).toMatchObject({ filePath: "vault/Loose.md", canWrite: false });
  });

  it("finds an idea to start from", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const note = await t.run(async (ctx) =>
      addNote(
        ctx,
        OWNER,
        await addArticle(ctx, OWNER, "Alpha"),
        "protect whole mornings",
      ),
    );
    const hits = await owner.query(api.ideaGraph.search, { query: "mornings" });
    expect(hits).toMatchObject([{ key: nodeKey("note", note), kind: "note" }]);
    expect(await owner.query(api.ideaGraph.search, { query: "m" })).toEqual([]);
  });
});

describe("links the reader makes", () => {
  async function setup() {
    const fixture = await secondReaderTest(modules);
    const ids = await fixture.t.run(async (ctx) => {
      const article = await addArticle(ctx, OWNER, "Alpha");
      const theirs = await addArticle(ctx, fixture.readerLibraryId, "Theirs");
      return {
        a: nodeKey("note", await addNote(ctx, OWNER, article, "a")),
        b: nodeKey("note", await addNote(ctx, OWNER, article, "b")),
        theirs: nodeKey(
          "note",
          await addNote(ctx, fixture.readerLibraryId, theirs, "theirs"),
        ),
      };
    });
    return { ...fixture, ...ids };
  }

  it("links two of the reader's own ideas once, whichever way round", async () => {
    const { t, owner, a, b } = await setup();
    const first = await owner.mutation(api.ideaGraph.link, { from: a, to: b });
    expect(await owner.mutation(api.ideaGraph.link, { from: a, to: b })).toBe(
      first,
    );
    expect(await owner.mutation(api.ideaGraph.link, { from: b, to: a })).toBe(
      first,
    );
    expect(
      await t.run((ctx) => ctx.db.query("ideaLinks").collect()),
    ).toHaveLength(1);
  });

  it("refuses a self-link, a missing idea and someone else's", async () => {
    const { owner, a, theirs } = await setup();
    await expect(
      owner.mutation(api.ideaGraph.link, { from: a, to: a }),
    ).rejects.toThrow(/itself/);
    await expect(
      owner.mutation(api.ideaGraph.link, { from: a, to: theirs }),
    ).rejects.toThrow(/isn't in your notes/);
    await expect(
      owner.mutation(api.ideaGraph.link, { from: a, to: "note:bogus" }),
    ).rejects.toThrow(/isn't in your notes/);
  });

  it("removes a link only for its owner", async () => {
    const { t, owner, reader, a, b } = await setup();
    await owner.mutation(api.ideaGraph.link, { from: a, to: b });
    await reader.mutation(api.ideaGraph.unlink, { a, b });
    expect(
      await t.run((ctx) => ctx.db.query("ideaLinks").collect()),
    ).toHaveLength(1);
    await owner.mutation(api.ideaGraph.unlink, { a: b, b: a });
    expect(
      await t.run((ctx) => ctx.db.query("ideaLinks").collect()),
    ).toHaveLength(0);
  });

  it("saves a connected note linked to its centre, and the map shows it at once", async () => {
    const { t, owner, a } = await setup();
    const key = await owner.mutation(api.ideaGraph.writeConnected, {
      from: a,
      content: "<p>If the schedule does the work</p>",
      contentPlain: "If the schedule does the work",
      prompt: "Block whole mornings",
    });
    const row = await t.run((ctx) => ctx.db.query("userNotes").collect());
    expect(row.find((n) => nodeKey("note", n._id) === key)).toMatchObject({
      userId: OWNER,
      prompt: "Block whole mornings",
    });
    const g = await owner.query(api.ideaGraph.graph, { centre: a });
    const edge = g.edges.find((e) => e.b === key || e.a === key);
    expect(edge?.reasons.map((r) => r.text)).toContain("You linked these");
  });

  it("will not write beside someone else's idea, an empty note, or an article-less vault note", async () => {
    const { t, owner, theirs } = await setup();
    await expect(
      owner.mutation(api.ideaGraph.writeConnected, {
        from: theirs,
        content: "x",
        contentPlain: "x",
      }),
    ).rejects.toThrow(/isn't in your notes/);
    const vault = await t.run((ctx) => addVault(ctx, OWNER, "Loose"));
    await expect(
      owner.mutation(api.ideaGraph.writeConnected, {
        from: nodeKey("vault", vault),
        content: "x",
        contentPlain: "x",
      }),
    ).rejects.toThrow(/isn't tied to an article/);
    await expect(
      owner.mutation(api.ideaGraph.writeConnected, {
        from: nodeKey("vault", vault),
        content: " ",
        contentPlain: " ",
      }),
    ).rejects.toThrow(/Write something/);
  });
});

describe("edge reasons", () => {
  const completion = (reason: string) =>
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      Response.json({
        id: "reason-fixture",
        created: 1,
        model: JSON.parse(String(init?.body)).model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify({ reason }) },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
    );

  async function twoFarNotes() {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    const t = await ownerWithKey(modules);
    const ids = await t.run(async (ctx) => {
      const one = await addArticle(ctx, OWNER, "One");
      const two = await addArticle(ctx, OWNER, "Two");
      return {
        a: await addNote(ctx, OWNER, one, "protected mornings"),
        b: await addNote(ctx, OWNER, two, "remote teams ship faster"),
      };
    });
    return { t, a: nodeKey("note", ids.a), b: nodeKey("note", ids.b), ids };
  }

  it("answers a structural edge without calling a model", async () => {
    const provider = completion("unused");
    vi.stubGlobal("fetch", provider);
    const { t, a, b } = await twoFarNotes();
    await t.mutation(api.ideaGraph.link, { from: a, to: b });
    const result = await t.action(api.actions.explainIdeaEdge.explain, {
      a,
      b,
    });
    expect(result).toEqual({
      source: "structural",
      reasons: [{ type: "linked", text: "You linked these" }],
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it("generates once for an embedding-only edge, then serves it from the cache", async () => {
    const provider = completion("Both are about when focused work gets done.");
    vi.stubGlobal("fetch", provider);
    const { t, a, b } = await twoFarNotes();
    const first = await t.action(api.actions.explainIdeaEdge.explain, { a, b });
    expect(first).toEqual({
      source: "generated",
      reason: "Both are about when focused work gets done.",
      cached: false,
    });
    const again = await t.action(api.actions.explainIdeaEdge.explain, {
      a: b,
      b: a,
    });
    expect(again).toMatchObject({ source: "generated", cached: true });
    expect(provider).toHaveBeenCalledOnce();
    // Only the two texts and their article titles go to the model
    const prompt = JSON.stringify(
      JSON.parse(String(provider.mock.calls[0][1]?.body)),
    );
    expect(prompt).toContain("protected mornings");
    expect(prompt).toContain("remote teams ship faster");
  });

  it("regenerates when either idea's text changes", async () => {
    const provider = completion("A fresh sentence.");
    vi.stubGlobal("fetch", provider);
    const { t, a, b, ids } = await twoFarNotes();
    await t.action(api.actions.explainIdeaEdge.explain, { a, b });
    await t.mutation(api.userNotes.update, {
      noteId: ids.a,
      content: "<p>entirely different</p>",
      contentPlain: "entirely different",
    });
    const result = await t.action(api.actions.explainIdeaEdge.explain, {
      a,
      b,
    });
    expect(result).toMatchObject({ cached: false });
    expect(provider).toHaveBeenCalledTimes(2);
    const rows = await t.run((ctx) => ctx.db.query("edgeReasons").collect());
    expect(rows).toHaveLength(1);
  });

  it("refuses an idea that isn't the reader's", async () => {
    const { t, a } = await twoFarNotes();
    await expect(
      t.action(api.actions.explainIdeaEdge.explain, { a, b: "note:bogus" }),
    ).rejects.toThrow(/aren't in your notes/);
  });

  it("keeps the cache per reader", async () => {
    const { t, a, b } = await twoFarNotes();
    await t.mutation(internal.ideaGraph.saveReason, {
      userId: "someone_else",
      pair: "x|y",
      fingerprint: "f",
      reason: "r",
      model: "m",
    });
    const context = await t.query(internal.ideaGraph.edgeContext, {
      userId: OWNER,
      a,
      b,
    });
    expect(context?.cached).toBeNull();
  });
});
