/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerWithKey, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { buildGraph } from "./ideaGraph";
import {
  ARTICLE_READS,
  GRAPH_READ_BUDGET,
  MAX_NODES,
  nodeKey,
  ReadBudget,
} from "./lib/ideaGraph";
import { loadNode } from "./lib/ideaNodes";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A vault idea is keyed by its file, so it outlives reindexing. */
const vaultNode = (name: string) => nodeKey("vault", `vault/${name}.md`);

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

/**
 * Wraps a db so every document a read returns is counted, with its size and
 * the table it came from, however the query is built.
 */
function countingDb(db: MutationCtx["db"]) {
  const reads = { documents: 0, articles: 0, bytes: 0 };
  const tally = (table: string | undefined, rows: unknown) => {
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    reads.documents += list.length;
    if (table === "articles") reads.articles += list.length;
    for (const row of list) reads.bytes += JSON.stringify(row).length;
  };
  const wrap = (target: object, table?: string): never =>
    new Proxy(target, {
      get(obj, prop) {
        const value = (obj as Record<string | symbol, unknown>)[prop];
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = value.apply(obj, args);
          const from =
            prop === "query" || prop === "get" ? String(args[0]) : table;
          if (result && typeof result.then === "function")
            return result.then((rows: unknown) => {
              tally(from, rows);
              return rows;
            });
          return result && typeof result === "object"
            ? wrap(result, from)
            : result;
        };
      },
    }) as never;
  return { reads, db: wrap(db) as MutationCtx["db"] };
}

function addAnnotation(
  ctx: MutationCtx,
  articleId: Id<"articles">,
  fields: { notePath?: string; articleRefId?: Id<"articles"> },
) {
  return ctx.db.insert("annotations", {
    articleId,
    userId: OWNER,
    type: "cross_reference",
    anchorText: "x",
    anchorStartOffset: 0,
    anchorEndOffset: 1,
    content: "ties in",
    relevanceScore: 0.9,
    wasViewed: false,
    wasDismissed: false,
    createdAt: Date.now(),
    ...fields,
  });
}

describe("idea graph read budget", () => {
  it("reads no more documents than the budget, from a library full of links, tags and notes", async () => {
    const { t } = await secondReaderTest(modules);
    const centre = await t.run(async (ctx) => {
      const articles: Id<"articles">[] = [];
      for (let a = 0; a < 12; a++) {
        const article = await addArticle(ctx, OWNER, `Article ${a}`);
        articles.push(article);
        for (let i = 0; i < 12; i++) {
          await addNote(ctx, OWNER, article, `note ${a}.${i}`);
          await addMark(ctx, OWNER, article, `mark ${a}.${i}`);
          await ctx.db.insert("companionThreads", {
            userId: OWNER,
            articleId: article,
            mode: "ask",
            selection: `passage ${a}.${i}`,
            turns: [{ role: "assistant", content: "An answer." }],
            keptAt: 1,
            createdAt: 1,
            updatedAt: 1,
          });
        }
      }
      for (const tag of ["one", "two", "three", "four"])
        await addTag(ctx, OWNER, tag, articles);
      return nodeKey("article", articles[0]);
    });
    for (const args of [{}, { centre }]) {
      const counted = await t.run(async (ctx) => {
        const { reads, db } = countingDb(ctx.db);
        const g = await buildGraph({ db }, OWNER, args);
        return { documents: reads.documents, nodes: g.nodes.length };
      });
      expect(counted.documents).toBeLessThanOrEqual(GRAPH_READ_BUDGET);
      expect(counted.documents).toBeGreaterThan(20);
      expect(counted.nodes).toBeLessThanOrEqual(MAX_NODES);
    }
  });

  it("reads at most a few whole articles however many connections point at them", async () => {
    const { t } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      const home = await addArticle(ctx, OWNER, "Home");
      await addNote(ctx, OWNER, home, "centre");
      for (let i = 0; i < 20; i++) {
        // Articles hold their full text, which can approach a megabyte
        const other = await ctx.db.insert("articles", {
          userId: OWNER,
          guid: `big-${i}`,
          url: `https://example.com/big-${i}`,
          title: `Big ${i}`,
          content: "x".repeat(899_000),
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: Date.now(),
        });
        await addNote(ctx, OWNER, other, `elsewhere ${i}`);
        await addAnnotation(ctx, home, { articleRefId: other });
      }
    });
    const counted = await t.run(async (ctx) => {
      const { reads, db } = countingDb(ctx.db);
      const g = await buildGraph({ db }, OWNER, {});
      return { ...reads, nodes: g.nodes.length };
    });
    expect(counted.articles).toBeLessThanOrEqual(ARTICLE_READS);
    // ~900KB each: the cap is what keeps this clear of Convex's 16MiB read limit
    expect(counted.bytes).toBeLessThan(10 * 1024 * 1024);
    expect(counted.nodes).toBeGreaterThan(1);
  });

  it("labels an article from its summary, or plainly, once whole-article reads are spent", async () => {
    const { t } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => ({
      withSummary: await addArticle(ctx, OWNER, "Has a summary"),
      without: await addArticle(ctx, OWNER, "Has none"),
    }));
    await t.run(async (ctx) => {
      await ctx.db.insert("summaries", {
        userId: OWNER,
        articleId: ids.withSummary,
        gist: "A gist.",
        thesis: "Interruptions cost more than minutes.",
        model: "m",
        createdAt: 5,
      } as never);
      const spent = () => new ReadBudget(160, 0);
      const db = { db: ctx.db };
      expect(
        await loadNode(
          db,
          OWNER,
          nodeKey("article", ids.withSummary),
          spent(),
          true,
        ),
      ).toMatchObject({ label: "Interruptions cost more than minutes." });
      expect(
        await loadNode(
          db,
          OWNER,
          nodeKey("article", ids.without),
          spent(),
          true,
        ),
      ).toMatchObject({ label: "An article" });
      // A key the client typed gets no such benefit of the doubt
      expect(
        await loadNode(db, OWNER, nodeKey("article", ids.without), spent()),
      ).toBeNull();
    });
  });

  it("still gives the centre its neighbours when discovery finds far more than it can read", async () => {
    const { t } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      const home = await addArticle(ctx, OWNER, "Home");
      const articles: Id<"articles">[] = [home];
      for (let a = 0; a < 6; a++) {
        const article = await addArticle(ctx, OWNER, `Six ${a}`);
        articles.push(article);
        for (let i = 0; i < 8; i++) {
          await addNote(ctx, OWNER, article, `n${a}.${i}`);
          await addMark(ctx, OWNER, article, `m${a}.${i}`);
        }
      }
      for (const tag of ["one", "two", "three"])
        await addTag(ctx, OWNER, tag, articles);
      for (let i = 0; i < 20; i++) {
        const other = await addArticle(ctx, OWNER, `Linked ${i}`);
        await addNote(ctx, OWNER, other, `linked ${i}`);
        await addAnnotation(ctx, home, { articleRefId: other });
      }
      for (let i = 0; i < 8; i++) await addNote(ctx, OWNER, home, `home ${i}`);
    });
    const counted = await t.run(async (ctx) => {
      const { reads, db } = countingDb(ctx.db);
      const g = await buildGraph({ db }, OWNER, {});
      return {
        documents: reads.documents,
        ring: g.nodes.filter((n) => n.hop === 1).length,
      };
    });
    expect(counted.documents).toBeLessThanOrEqual(GRAPH_READ_BUDGET);
    expect(counted.ring).toBeGreaterThanOrEqual(5);
  });

  it("asks for only as many of each kind as an article's expansion needs", async () => {
    const { t } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const article = await addArticle(ctx, OWNER, "Alpha");
      for (let i = 0; i < 30; i++) {
        await addNote(ctx, OWNER, article, `n${i}`);
        await addMark(ctx, OWNER, article, `m${i}`);
      }
      return { article };
    });
    const { listed } = await t.run(async (ctx) => {
      const { reads, db } = countingDb(ctx.db);
      const { ideasOnArticle } = await import("./lib/ideaSignals");
      const keys = await ideasOnArticle({ db }, OWNER, ids.article, {
        notes: 2,
        highlights: 1,
        answers: 0,
      });
      return { listed: { keys, documents: reads.documents } };
    });
    expect(listed.documents).toBe(3);
    expect(listed.keys).toHaveLength(3);
  });
});

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
        notePath: "vault/Deep work.md",
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
    const vaultKey = vaultNode("Deep work");
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
    await owner.mutation(api.ideaLinks.link, {
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
    // Two slots are held back for articles, and the read budget may stop the second ring short
    expect(g.nodes.length).toBeGreaterThanOrEqual(MAX_NODES - 4);
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
        (c) => nodeKey("vault", c.filePath),
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
    // Only the owner's note and its own article, nothing of the other reader's
    expect(ownerGraph.nodes.map((n) => n.kind).sort()).toEqual([
      "article",
      "note",
    ]);

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
        key: vaultNode("Loose"),
      }),
    ).toMatchObject({ filePath: "vault/Loose.md", canWrite: false });
  });

  it("brings the centre's article onto the map, and opens it as its title and one point", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const article = await addArticle(ctx, OWNER, "The quiet cost");
      await ctx.db.insert("summaries", {
        userId: OWNER,
        articleId: article,
        gist: "A gist.",
        thesis: "Interruptions cost more than the minutes lost.",
        model: "m",
        createdAt: Date.now(),
      } as never);
      await addNote(ctx, OWNER, article, "centre");
      return { article };
    });
    const g = await owner.query(api.ideaGraph.graph, {});
    const key = nodeKey("article", ids.article);
    expect(g.nodes.find((n) => n.key === key)).toMatchObject({
      kind: "article",
      label: "The quiet cost",
      hop: 1,
    });
    expect(
      g.edges.find((e) => e.b === key)?.reasons.map((r) => r.text),
    ).toEqual(["From this article"]);
    expect(await owner.query(api.ideaGraph.node, { key })).toMatchObject({
      kind: "article",
      text: "Interruptions cost more than the minutes lost.",
      articleId: ids.article,
      articleTitle: "The quiet cost",
    });
    // Opened as the centre, the article gathers the ideas written on it
    const open = await owner.query(api.ideaGraph.graph, { centre: key });
    expect(open.nodes.filter((n) => n.kind === "note")).toHaveLength(1);
  });

  it("joins a second article as the shared source of two ideas, and keeps the cap", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const one = await addArticle(ctx, OWNER, "One");
      const two = await addArticle(ctx, OWNER, "Two");
      await addTag(ctx, OWNER, "focus", [one, two]);
      for (let i = 0; i < 3; i++) await addNote(ctx, OWNER, two, `other ${i}`);
      await addNote(ctx, OWNER, one, "centre");
      return { two };
    });
    const g = await owner.query(api.ideaGraph.graph, {});
    const hub = g.nodes.filter((n) => n.kind === "article");
    expect(hub.map((n) => n.label).sort()).toEqual(["One", "Two"]);
    expect(g.nodes.length).toBeLessThanOrEqual(MAX_NODES);
    // The hub is wired to the ideas it is the source of
    const hubKey = nodeKey("article", ids.two);
    expect(
      g.edges.filter((e) => e.b === hubKey || e.a === hubKey).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("never lets articles push the map past the cap", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      for (let a = 0; a < 6; a++) {
        const article = await addArticle(ctx, OWNER, `Article ${a}`);
        for (let i = 0; i < 6; i++)
          await addNote(ctx, OWNER, article, `n${a}${i}`);
      }
    });
    const g = await owner.query(api.ideaGraph.graph, {});
    expect(g.nodes.length).toBeLessThanOrEqual(MAX_NODES);
    const keys = new Set(g.nodes.map((n) => n.key));
    for (const e of g.edges) {
      expect(keys.has(e.a) && keys.has(e.b)).toBe(true);
    }
  });

  it("keeps a vault idea and its links when the file is reindexed", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const note = await t.run(async (ctx) =>
      addNote(ctx, OWNER, await addArticle(ctx, OWNER, "Alpha"), "centre"),
    );
    const vault = vaultNode("Deep work");
    await t.run((ctx) => addVault(ctx, OWNER, "Deep work"));
    await owner.mutation(api.ideaLinks.link, {
      from: nodeKey("note", note),
      to: vault,
    });
    // Reindexing replaces the file's chunks, so every chunk id changes
    await t.run(async (ctx) => {
      for (const chunk of await ctx.db.query("noteChunks").collect())
        await ctx.db.delete(chunk._id);
      await ctx.db.insert("noteChunks", {
        userId: OWNER,
        filePath: "vault/Deep work.md",
        fileName: "Deep work.md",
        chunkIndex: 0,
        content: "Rewritten after reindexing",
        embedding: [1, 0],
        fileHash: "new",
        indexedAt: Date.now(),
      });
    });
    const g = await owner.query(api.ideaGraph.graph, {});
    const edge = g.edges.find((e) => e.b === vault);
    expect(edge?.reasons.map((r) => r.text)).toContain("You linked these");
    expect(await owner.query(api.ideaGraph.node, { key: vault })).toMatchObject(
      {
        text: "Rewritten after reindexing",
      },
    );
  });

  it("always gives a note just written from the map a place, even beside seven older links", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const article = await addArticle(ctx, OWNER, "Alpha");
      const other = await addArticle(ctx, OWNER, "Other");
      const old: string[] = [];
      for (let i = 0; i < 7; i++)
        old.push(nodeKey("note", await addNote(ctx, OWNER, other, `old ${i}`)));
      const far = await addNote(
        ctx,
        OWNER,
        await addArticle(ctx, OWNER, "Far"),
        "far",
      );
      const centre = await addNote(ctx, OWNER, article, "centre");
      return {
        old,
        far: nodeKey("note", far),
        centre: nodeKey("note", centre),
      };
    });
    for (const [i, to] of ids.old.entries())
      await t.run((ctx) =>
        ctx.db.insert("ideaLinks", {
          userId: OWNER,
          from: ids.centre,
          to,
          createdAt: 100 + i,
        }),
      );
    const written = await owner.mutation(api.ideaLinks.writeConnected, {
      from: ids.centre,
      content: "<p>new</p>",
      contentPlain: "new",
    });
    const plain = await owner.query(api.ideaGraph.graph, {
      centre: ids.centre,
    });
    expect(plain.nodes.filter((n) => n.hop === 1).map((n) => n.key)).toContain(
      written,
    );
    // Whatever else is near, the pinned idea has its place
    const pinned = await owner.query(api.ideaGraph.graph, {
      centre: ids.centre,
      pin: ids.far,
    });
    expect(pinned.nodes.filter((n) => n.hop === 1).map((n) => n.key)).toContain(
      ids.far,
    );
    expect(pinned.nodes.filter((n) => n.hop === 1)).toHaveLength(7);
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
    const first = await owner.mutation(api.ideaLinks.link, { from: a, to: b });
    expect(await owner.mutation(api.ideaLinks.link, { from: a, to: b })).toBe(
      first,
    );
    expect(await owner.mutation(api.ideaLinks.link, { from: b, to: a })).toBe(
      first,
    );
    expect(
      await t.run((ctx) => ctx.db.query("ideaLinks").collect()),
    ).toHaveLength(1);
  });

  it("drops a note's links, in both directions, when the note is deleted", async () => {
    vi.useFakeTimers();
    const { t, owner, a, b } = await setup();
    const c = await t.run(async (ctx) => {
      const article = await addArticle(ctx, OWNER, "Beta");
      return nodeKey("note", await addNote(ctx, OWNER, article, "c"));
    });
    await owner.mutation(api.ideaLinks.link, { from: a, to: b });
    await owner.mutation(api.ideaLinks.link, { from: c, to: a });
    await owner.mutation(api.ideaLinks.link, { from: b, to: c });
    await owner.mutation(api.userNotes.remove, {
      noteId: a.slice("note:".length) as Id<"userNotes">,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    const rows = await t.run((ctx) => ctx.db.query("ideaLinks").collect());
    expect(rows.map((r) => [r.from, r.to])).toEqual([[b, c]]);
  });

  it("deletes a heavily linked note first and sweeps its links in bounded batches", async () => {
    vi.useFakeTimers();
    const { t, owner, a } = await setup();
    const noteId = a.slice("note:".length) as Id<"userNotes">;
    await t.run(async (ctx) => {
      for (let i = 0; i < 230; i++)
        await ctx.db.insert("ideaLinks", {
          userId: OWNER,
          from: i % 2 ? a : `note:other${i}`,
          to: i % 2 ? `note:other${i}` : a,
          createdAt: i,
        });
    });
    await owner.mutation(api.userNotes.remove, { noteId });
    // The note is gone at once; the links follow in batches of at most 100
    expect(await t.run((ctx) => ctx.db.get("userNotes", noteId))).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("ideaLinks").collect()),
    ).toHaveLength(230);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    expect(
      await t.run((ctx) => ctx.db.query("ideaLinks").collect()),
    ).toHaveLength(0);
    const sweeps = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").take(50)).filter((j) =>
        j.name.includes("sweep"),
      ),
    );
    expect(sweeps).toHaveLength(3);
  });

  it("refuses a self-link, a missing idea and someone else's", async () => {
    const { owner, a, theirs } = await setup();
    await expect(
      owner.mutation(api.ideaLinks.link, { from: a, to: a }),
    ).rejects.toThrow(/itself/);
    await expect(
      owner.mutation(api.ideaLinks.link, { from: a, to: theirs }),
    ).rejects.toThrow(/isn't in your notes/);
    await expect(
      owner.mutation(api.ideaLinks.link, { from: a, to: "note:bogus" }),
    ).rejects.toThrow(/isn't in your notes/);
  });

  it("removes a link only for its owner", async () => {
    const { t, owner, reader, a, b } = await setup();
    await owner.mutation(api.ideaLinks.link, { from: a, to: b });
    await reader.mutation(api.ideaLinks.unlink, { a, b });
    expect(
      await t.run((ctx) => ctx.db.query("ideaLinks").collect()),
    ).toHaveLength(1);
    await owner.mutation(api.ideaLinks.unlink, { a: b, b: a });
    expect(
      await t.run((ctx) => ctx.db.query("ideaLinks").collect()),
    ).toHaveLength(0);
  });

  it("saves a connected note linked to its centre, and the map shows it at once", async () => {
    const { t, owner, a } = await setup();
    const key = await owner.mutation(api.ideaLinks.writeConnected, {
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
      owner.mutation(api.ideaLinks.writeConnected, {
        from: theirs,
        content: "x",
        contentPlain: "x",
      }),
    ).rejects.toThrow(/isn't in your notes/);
    const vault = await t.run((ctx) => addVault(ctx, OWNER, "Loose"));
    await expect(
      owner.mutation(api.ideaLinks.writeConnected, {
        from: vaultNode("Loose"),
        content: "x",
        contentPlain: "x",
      }),
    ).rejects.toThrow(/isn't tied to an article/);
    await expect(
      owner.mutation(api.ideaLinks.writeConnected, {
        from: vaultNode("Loose"),
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
    await t.mutation(api.ideaLinks.link, { from: a, to: b });
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

  it("won't write a reason for a library that is being deleted", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    void owner;
    await reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
    await t.mutation(internal.ideaEdgeReasons.saveReason, {
      userId: readerLibraryId,
      pair: "note:a|note:b",
      fingerprint: "f",
      reason: "late",
      model: "m",
    });
    expect(await t.run((ctx) => ctx.db.query("edgeReasons").collect())).toEqual(
      [],
    );
  });

  it("finds an article-reference connection written from either article, before asking a model", async () => {
    const { t } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => {
      const one = await addArticle(ctx, OWNER, "One");
      const two = await addArticle(ctx, OWNER, "Two");
      // Marginalia wrote the connection on Two, pointing back at One
      await addAnnotation(ctx, two, { articleRefId: one });
      return {
        a: nodeKey("note", await addNote(ctx, OWNER, one, "on one")),
        b: nodeKey("note", await addNote(ctx, OWNER, two, "on two")),
      };
    });
    for (const [a, b] of [
      [ids.a, ids.b],
      [ids.b, ids.a],
    ]) {
      const context = await t.query(internal.ideaEdgeReasons.edgeContext, {
        userId: OWNER,
        a,
        b,
      });
      expect(context?.structural.map((r) => r.type)).toEqual(["connection"]);
    }
  });

  it("won't write a reason for a library with no reader row left, as after a purge", async () => {
    const { t } = await secondReaderTest(modules);
    await t.mutation(internal.ideaEdgeReasons.saveReason, {
      userId: "purged_library",
      pair: "note:a|note:b",
      fingerprint: "f",
      reason: "late",
      model: "m",
    });
    expect(await t.run((ctx) => ctx.db.query("edgeReasons").collect())).toEqual(
      [],
    );
  });

  it("keeps the cache per reader", async () => {
    const { t, a, b } = await twoFarNotes();
    await t.mutation(internal.ideaEdgeReasons.saveReason, {
      userId: "someone_else",
      pair: "x|y",
      fingerprint: "f",
      reason: "r",
      model: "m",
    });
    const context = await t.query(internal.ideaEdgeReasons.edgeContext, {
      userId: OWNER,
      a,
      b,
    });
    expect(context?.cached).toBeNull();
  });
});
