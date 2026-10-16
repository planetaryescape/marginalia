/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  annotationCandidateSchema,
  buildUserPrompt,
  proposedTags,
  resolveNotePath,
  SYSTEM_PROMPT,
} from "./actions/generateAnnotations";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const vector = Array.from({ length: 1536 }, () => 0.5);
const SENTENCES = [
  "Every team we studied shipped more features.",
  "Remote work makes teams faster, so the conclusion is hard to avoid.",
  "Either embrace remote work or fall behind.",
  "Written culture matters most to remote teams.",
];
const CONTENT = SENTENCES.join(" ").concat(" ", "Filler sentence. ".repeat(60));

beforeEach(() => {
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  vi.stubEnv("OPENROUTER_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the annotation prompt and schema", () => {
  it("names the three families and every kind", () => {
    for (const word of [
      "Pushback",
      "Support",
      "Connection",
      "tension",
      "fallacy",
      "assumption",
      "unsupported",
      "other_explanation",
      "strong_point",
      "crux",
      "cross_reference",
      "context",
      "question",
    ])
      expect(SYSTEM_PROMPT).toContain(word);
  });

  it("leans toward pushback, names fallacies, budgets by density and asks for notes with substance", () => {
    expect(SYSTEM_PROMPT).toMatch(/55 to 60 percent/);
    expect(SYSTEM_PROMPT).toMatch(/Name the specific fallacy/);
    expect(SYSTEM_PROMPT).toMatch(/one per screen of text/);
    // Notes say what was noticed and why it matters, not bare labels (2026-10-17)
    expect(SYSTEM_PROMPT).toMatch(/why it matters/i);
    expect(SYSTEM_PROMPT).toMatch(/two to four sentences/i);
    expect(SYSTEM_PROMPT).not.toMatch(/as short as it can be/i);
    expect(SYSTEM_PROMPT).not.toMatch(/3-7|3 to 7/);
  });

  it("keeps the anchor rules, the relevance scale and the reflection box", () => {
    expect(SYSTEM_PROMPT).toMatch(/EXACT verbatim substring/);
    expect(SYSTEM_PROMPT).toMatch(/0\.9–1\.0: essential/);
    expect(SYSTEM_PROMPT).toMatch(/## Reflection Box/);
  });

  it("asks for the one point, the summary and tags with a reason for new ones", () => {
    expect(SYSTEM_PROMPT).toMatch(/thesis/);
    expect(SYSTEM_PROMPT).toMatch(/gist/);
    expect(SYSTEM_PROMPT).toMatch(/A new tag without a reason is discarded/);
    const shape = JSON.stringify(
      (annotationCandidateSchema as unknown as { shape: object }).shape,
      (_key, value) => (typeof value === "function" ? undefined : value),
    );
    expect(Object.keys(annotationCandidateSchema.shape)).toEqual(
      expect.arrayContaining([
        "thesis",
        "gist",
        "tags",
        "annotations",
        "reflection",
      ]),
    );
    void shape;
  });

  it("gives each article its own budget", () => {
    const prompt = buildUserPrompt({
      title: "T",
      articleText: "Body.",
      truncated: false,
      contextText: "",
      wordCount: 3_500,
      vocabulary: ["hiring"],
    });
    expect(prompt).toContain("about 3500 words");
    expect(prompt).toContain("about 10 notes");
    expect(prompt).toContain("hiring");
    expect(
      buildUserPrompt({
        title: "T",
        articleText: "Body.",
        truncated: false,
        contextText: "",
        wordCount: 150,
        vocabulary: [],
      }),
    ).toContain("None yet.");
  });

  it("accepts a response with no summary, tags or fallacy name", () => {
    expect(
      annotationCandidateSchema.safeParse({
        annotations: [
          {
            type: "something new",
            anchorText: "a",
            content: "c",
            relevanceScore: 0.7,
            reasoning: "r",
          },
        ],
        reflection: {
          strongestPoint: "s",
          weakestAssumption: "w",
          credibleCounterview: "c",
          questionForYou: "q",
        },
      }).success,
    ).toBe(true);
  });
});

describe("proposedTags", () => {
  const offered = new Set(["hiring", "recruiting"]);
  it("keeps listed tags, requires a reason for new ones, and caps at three", () => {
    const kept = proposedTags(
      [
        { name: "Hiring" },
        { name: "Recruiting" },
        { name: "gardening" },
        { name: "markets", reason: "none fits" },
        { name: "pricing", reason: "none fits" },
        { name: "mergers", reason: "none fits" },
      ],
      offered,
    );
    expect(kept.map((tag) => tag.key)).toEqual([
      "hiring",
      "recruiting",
      "market",
    ]);
  });

  it("handles missing tags, blank names and prototype names", () => {
    expect(proposedTags(undefined, offered)).toEqual([]);
    expect(proposedTags([{ name: " # " }], offered)).toEqual([]);
    expect(
      proposedTags([{ name: "constructor", reason: "r" }], offered),
    ).toMatchObject([{ key: "constructor" }]);
    expect(proposedTags([{ name: "constructor" }], offered)).toEqual([]);
  });
});

describe("resolveNotePath", () => {
  it("resolves to the vault path it was shown, with prototype names harmless", () => {
    const paths = ["Reading/Attention.md"];
    expect(resolveNotePath("attention", paths)).toBe("Reading/Attention.md");
    expect(resolveNotePath("Attention.md", paths)).toBe("Reading/Attention.md");
    expect(resolveNotePath("constructor", paths)).toBe("constructor");
    expect(resolveNotePath(undefined, paths)).toBeUndefined();
  });
});

function addArticle(
  ctx: MutationCtx,
  userId: string,
  guid: string,
  fields: Record<string, unknown> = {},
) {
  return ctx.db.insert("articles", {
    userId,
    guid,
    url: `https://example.com/${guid}`,
    title: `Title ${guid}`,
    excerpt: `Excerpt ${guid}`,
    content: CONTENT,
    wordCount: 700,
    estimatedReadMinutes: 4,
    embedding: vector,
    extractionStatus: "extracted",
    annotationStatus: "pending",
    createdAt: Date.now(),
    ...fields,
  });
}

describe("generateForArticle", () => {
  async function run(
    respond: (ids: {
      neighbour: Id<"articles">;
      foreign: Id<"articles">;
    }) => unknown,
    options: {
      embeddings?: boolean;
      before?: (f: Fixture) => Promise<void>;
    } = {},
  ) {
    const f = await secondReaderTest(modules);
    await saveTestCredential(
      f.t,
      f.readerLibraryId,
      "openrouter",
      "sk-or-fixture-0001",
    );
    const ids = await f.t.run(async (ctx) => ({
      target: await addArticle(ctx, f.readerLibraryId, "target"),
      neighbour: await addArticle(ctx, f.readerLibraryId, "neighbour", {
        annotationStatus: "annotated",
        finishedAt: undefined,
      }),
      // Identical text and vector, in another library: must never be offered
      foreign: await addArticle(ctx, OWNER, "foreign", {
        title: "Secret owner article",
        annotationStatus: "annotated",
      }),
    }));
    const fixture = { ...f, ...ids };
    await options.before?.(fixture);
    const prompts: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body));
        if (String(input).endsWith("/embeddings"))
          return Response.json({
            data: (request.input as string[]).map((_, index) => ({
              index,
              embedding: vector,
            })),
          });
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
                content: JSON.stringify(respond(ids)),
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    );
    await f.t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: ids.target,
    });
    const notes = await f.t.run((ctx) =>
      ctx.db
        .query("annotations")
        .withIndex("by_article", (q) => q.eq("articleId", ids.target))
        .collect(),
    );
    return { ...fixture, prompts, notes };
  }
  type Fixture = Awaited<ReturnType<typeof secondReaderTest>> & {
    target: Id<"articles">;
    neighbour: Id<"articles">;
    foreign: Id<"articles">;
  };

  const reflection = {
    strongestPoint: "s",
    weakestAssumption: "w",
    credibleCounterview: "c",
    questionForYou: "q",
  };
  const base = (fields: Record<string, unknown>) => ({
    anchorText: SENTENCES[0],
    content: "A short note.",
    relevanceScore: 0.8,
    reasoning: "r",
    ...fields,
  });

  it("writes every kind, validates library connections, and keeps other libraries out", async () => {
    const result = await run((ids) => ({
      thesis: "Remote work is not shown to make teams faster.",
      gist: "A claim about speed, argued from a loose sample.",
      tags: [
        {
          name: "remote work",
          description: "distributed teams",
          reason: "none fit",
        },
      ],
      annotations: [
        base({ type: "unsupported" }),
        base({
          type: "fallacy",
          fallacyName: "false dilemma",
          anchorText: SENTENCES[2],
        }),
        base({
          type: "cross_reference",
          anchorText: SENTENCES[3],
          articleRefId: ids.neighbour,
        }),
        // Invented, foreign and unknown: all dropped
        base({
          type: "cross_reference",
          anchorText: SENTENCES[1],
          articleRefId: "not-an-id",
        }),
        base({
          type: "cross_reference",
          anchorText: "Filler sentence.",
          articleRefId: ids.foreign,
        }),
        base({ type: "constructor", anchorText: "Filler sentence. Filler" }),
      ],
      reflection,
    }));
    expect(
      result.notes.map((n) => [n.type, n.fallacyName, n.articleRefId]),
    ).toEqual(
      expect.arrayContaining([
        ["unsupported", undefined, undefined],
        ["fallacy", "false dilemma", undefined],
        ["cross_reference", undefined, result.neighbour],
      ]),
    );
    expect(result.notes).toHaveLength(3);
    // The import pass records what the library held, for reading alongside
    const stamped = await result.t.run((ctx) => ctx.db.get(result.target));
    expect(stamped?.marginaliaFingerprint).toMatchObject({
      highlightsCount: 0,
      notesMax: 0,
    });

    // The prompt offered this library's neighbour and nothing of the owner's
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]).toContain(result.neighbour);
    expect(result.prompts[0]).toContain("Title neighbour");
    expect(result.prompts[0]).not.toContain("Secret owner article");
    expect(result.prompts[0]).not.toContain(result.foreign);
    expect(result.prompts[0]).toContain("Aim for about 2 notes");

    expect(
      await result.t.run((ctx) => ctx.db.get(result.target)),
    ).toMatchObject({
      annotationStatus: "annotated",
      annotationVersion: 3,
    });
    expect(
      await result.t.run((ctx) =>
        ctx.db
          .query("summaries")
          .withIndex("by_article", (q) => q.eq("articleId", result.target))
          .collect(),
      ),
    ).toMatchObject([
      {
        thesis: "Remote work is not shown to make teams faster.",
        gist: "A claim about speed, argued from a loose sample.",
      },
    ]);
    const tags = await result.t.run((ctx) => ctx.db.query("tags").collect());
    expect(tags).toMatchObject([
      {
        userId: result.readerLibraryId,
        key: "remotework",
        status: "candidate",
      },
    ]);
  });

  it("tags with an existing tag from the vocabulary it was shown", async () => {
    const result = await run(
      () => ({
        annotations: [],
        tags: [{ name: "Hiring" }, { name: "invented, no reason" }],
        reflection,
      }),
      {
        before: async (f) => {
          await f.t.run((ctx) =>
            ctx.db.insert("tags", {
              userId: f.readerLibraryId,
              name: "hiring",
              key: "hiring",
              status: "active",
              count: 4,
              aliases: [],
              createdAt: 1,
            }),
          );
        },
      },
    );
    expect(result.prompts[0]).toContain("hiring");
    const links = await result.t.run((ctx) =>
      ctx.db.query("articleTags").collect(),
    );
    expect(links).toHaveLength(1);
    expect(
      (await result.t.run((ctx) => ctx.db.query("tags").collect())).map(
        (tag) => [tag.key, tag.count],
      ),
    ).toEqual([["hiring", 5]]);
  });

  it("still annotates when the library has no neighbours, no vault and no tags", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(
      f.t,
      f.readerLibraryId,
      "openrouter",
      "sk-or-fixture-0002",
    );
    const target = await f.t.run((ctx) =>
      addArticle(ctx, f.readerLibraryId, "alone"),
    );
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body));
        if (String(input).endsWith("/embeddings"))
          return Response.json({
            data: (request.input as string[]).map((_, index) => ({
              index,
              embedding: vector,
            })),
          });
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
                content: JSON.stringify({
                  annotations: [base({ type: "strong_point" })],
                  reflection,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    );
    await f.t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: target,
    });
    expect(await f.t.run((ctx) => ctx.db.get(target))).toMatchObject({
      annotationStatus: "annotated",
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("annotations").collect()),
    ).toHaveLength(1);
    // No summary without a thesis in the answer, and no tags
    expect(await f.t.run((ctx) => ctx.db.query("summaries").collect())).toEqual(
      [],
    );
    expect(
      await f.t.run((ctx) => ctx.db.query("articleTags").collect()),
    ).toEqual([]);
  });

  it("leaves an annotated article's old margin when re-annotation fails", async () => {
    const f = await secondReaderTest(modules);
    await saveTestCredential(
      f.t,
      f.readerLibraryId,
      "openrouter",
      "sk-or-fixture-0003",
    );
    const target = await f.t.run(async (ctx) => {
      const id = await addArticle(ctx, f.readerLibraryId, "old", {
        annotationStatus: "annotated",
      });
      await ctx.db.insert("annotations", {
        articleId: id,
        userId: f.readerLibraryId,
        type: "context",
        anchorText: "a",
        anchorStartOffset: 0,
        anchorEndOffset: 1,
        content: "old note",
        relevanceScore: 0.8,
        wasViewed: false,
        wasDismissed: false,
        createdAt: 1,
      });
      return id;
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/embeddings"))
        return Response.json({ data: [] });
      return new Response("nope", { status: 400 });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await f.t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: target,
    });
    expect(await f.t.run((ctx) => ctx.db.get(target))).toMatchObject({
      annotationStatus: "annotated",
    });
    expect(
      (await f.t.run((ctx) => ctx.db.query("annotations").collect())).map(
        (n) => n.content,
      ),
    ).toEqual(["old note"]);
  });
});
