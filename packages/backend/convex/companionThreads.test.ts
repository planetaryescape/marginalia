/// <reference types="vite/client" />

import { expect, it } from "vitest";
import { ownerTest, secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

it("saves and reopens a contextual definition with its original passage and follow-ups", async () => {
  const t = await ownerTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "fixture",
      url: "https://example.com/fixture",
      title: "Markets",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  const threadId = await t.mutation(api.companionThreads.create, {
    articleId,
    mode: "define",
    selection: "elastic",
    paragraphIndex: 0,
    turns: [
      {
        role: "assistant",
        content: "Elastic here describes demand that changes with price.",
      },
    ],
  });
  await t.mutation(api.companionThreads.updateTurns, {
    threadId,
    turns: [
      {
        role: "assistant",
        content: "Elastic here describes demand that changes with price.",
      },
      { role: "user", content: "Would responsive fit?" },
      { role: "assistant", content: "Responsive to price fits this sentence." },
    ],
  });
  const [saved] = await t.query(api.companionThreads.listByArticle, {
    articleId,
  });
  expect(saved).toMatchObject({
    mode: "define",
    selection: "elastic",
    paragraphIndex: 0,
  });
  expect(saved.turns).toHaveLength(3);
  expect(saved.turns[2].content).toBe(
    "Responsive to price fits this sentence.",
  );
});

it("keeps an answer once, however many times Keep is pressed", async () => {
  const t = await ownerTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "keep",
      url: "https://example.com/keep",
      title: "Markets",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  const answer = {
    articleId,
    answerId: "answer-1",
    mode: "define" as const,
    selection: "elastic",
    paragraphIndex: 0,
    turns: [{ role: "assistant" as const, content: "Responsive to price." }],
  };
  const first = await t.mutation(api.companionThreads.keep, answer);
  const again = await t.mutation(api.companionThreads.keep, {
    ...answer,
    turns: [...answer.turns, { role: "user" as const, content: "More?" }],
  });
  expect(again).toBe(first);
  const rows = await t.query(api.companionThreads.listByArticle, { articleId });
  expect(rows).toHaveLength(1);
  expect(rows[0].keptAt).toBeTypeOf("number");
  expect(rows[0].turns).toHaveLength(2);
});

it("retains summary-definition provenance when a kept answer is hydrated", async () => {
  const t = await ownerTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "summary-fixture",
      url: "https://example.com",
      title: "A saved reading",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  const id = await t.mutation(api.companionThreads.keep, {
    articleId,
    answerId: "summary-answer",
    mode: "define",
    selection: "ascetic",
    summaryDefinition: true,
    turns: [{ role: "assistant", content: "Practicing self-denial." }],
  });
  const hydrated = await t.query(api.companionThreads.getBody, {
    threadId: id,
  });
  expect(hydrated).toMatchObject({
    mode: "define",
    selection: "ascetic",
    summaryDefinition: true,
  });
  expect(hydrated?.paragraphIndex).toBeUndefined();
});

it("keeps old clients working: create still saves a thread with no keptAt", async () => {
  const t = await ownerTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "old",
      url: "https://example.com/old",
      title: "Markets",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  await t.mutation(api.companionThreads.create, {
    articleId,
    mode: "ask",
    selection: "x",
    turns: [],
  });
  const [row] = await t.query(api.companionThreads.listByArticle, {
    articleId,
  });
  expect(row.keptAt).toBeUndefined();
});

it("never shrinks a kept transcript when a stale tab keeps it again", async () => {
  const t = await ownerTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "stale",
      url: "https://example.com/stale",
      title: "Markets",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  const first = [{ role: "assistant" as const, content: "One." }];
  const grown = [
    ...first,
    { role: "user" as const, content: "Why?" },
    { role: "assistant" as const, content: "Because." },
  ];
  const base = {
    articleId,
    answerId: "answer-1",
    mode: "ask" as const,
    selection: "x",
    question: "q",
    paragraphIndex: 0,
  };
  const id = await t.mutation(api.companionThreads.keep, {
    ...base,
    turns: grown,
  });
  await t.mutation(api.companionThreads.keep, { ...base, turns: first });
  const [row] = await t.query(api.companionThreads.listByArticle, {
    articleId,
  });
  expect(row._id).toBe(id);
  expect(row.turns).toHaveLength(3);
});

const makeArticle = (t: Awaited<ReturnType<typeof ownerTest>>, guid: string) =>
  t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid,
      url: `https://example.com/${guid}`,
      title: "Markets",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );

it("keeps two answers to the same passage and question as two rows, and a retried Keep as one", async () => {
  const t = await ownerTest(modules);
  const articleId = await makeArticle(t, "twins");
  const same = {
    articleId,
    mode: "explain" as const,
    selection: "tarn",
    paragraphIndex: 1,
  };
  const longer = [
    { role: "assistant" as const, content: "A long first answer." },
    { role: "user" as const, content: "More?" },
    { role: "assistant" as const, content: "Yes." },
  ];
  const shorter = [{ role: "assistant" as const, content: "A short one." }];
  const a = await t.mutation(api.companionThreads.keep, {
    ...same,
    answerId: "A",
    turns: longer,
  });
  const b = await t.mutation(api.companionThreads.keep, {
    ...same,
    answerId: "B",
    turns: shorter,
  });
  const retry = await t.mutation(api.companionThreads.keep, {
    ...same,
    answerId: "A",
    turns: longer,
  });
  expect(b).not.toBe(a);
  expect(retry).toBe(a);
  const rows = await t.query(api.companionThreads.listByArticle, { articleId });
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r._id === b)?.turns).toEqual(shorter);
});

it("upgrades an older saved thread in place when it is the row the answer came from", async () => {
  const t = await ownerTest(modules);
  const articleId = await makeArticle(t, "upgrade");
  const old = await t.mutation(api.companionThreads.create, {
    articleId,
    mode: "explain",
    selection: "tarn",
    turns: [{ role: "assistant", content: "Old." }],
  });
  const turns = [
    { role: "assistant" as const, content: "Old." },
    { role: "user" as const, content: "And?" },
    { role: "assistant" as const, content: "New." },
  ];
  const kept = await t.mutation(api.companionThreads.keep, {
    articleId,
    answerId: old,
    legacyId: old,
    mode: "explain",
    selection: "tarn",
    turns,
  });
  expect(kept).toBe(old);
  const rows = await t.query(api.companionThreads.listByArticle, { articleId });
  expect(rows).toHaveLength(1);
  expect(rows[0].keptAt).toBeTypeOf("number");
  expect(rows[0].turns).toHaveLength(3);
  // A second answer claiming the same row is a different answer: a row of its own
  const other = await t.mutation(api.companionThreads.keep, {
    articleId,
    answerId: "other",
    legacyId: old,
    mode: "explain",
    selection: "tarn",
    turns: [{ role: "assistant", content: "Other." }],
  });
  expect(other).not.toBe(old);
});

it("lists the signed-in reader's kept answers newest first, without embeddings or unkept rows", async () => {
  const f = await secondReaderTest(modules);
  const owned = (userId: string, guid: string) =>
    f.t.run((ctx) =>
      ctx.db.insert("articles", {
        userId,
        guid,
        url: `https://example.com/${guid}`,
        title: "Markets",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      }),
    );
  const mine = await owned("default_user", "mine");
  const theirs = await owned(f.readerLibraryId, "theirs");
  const row = (userId: string, articleId: typeof mine, over: object) =>
    f.t.run((ctx) =>
      ctx.db.insert("companionThreads", {
        userId,
        articleId,
        mode: "explain",
        selection: "x",
        turns: [{ role: "assistant", content: "A." }],
        embedding: [0.1, 0.2],
        createdAt: 1,
        updatedAt: 1,
        ...over,
      }),
    );
  const older = await row("default_user", mine, { keptAt: 10 });
  const newer = await row("default_user", mine, { keptAt: 20 });
  await row("default_user", mine, {});
  await row(f.readerLibraryId, theirs, { keptAt: 30 });

  const kept = await f.owner.query(api.companionThreads.listKept, {});
  expect(kept.map((r) => r._id)).toEqual([newer, older]);
  expect(kept.every((r) => !("embedding" in r))).toBe(true);
  const others = await f.reader.query(api.companionThreads.listKept, {});
  expect(others.map((r) => r.userId)).toEqual([f.readerLibraryId]);
});

it("refuses a stale tab's transcript, and takes a follow-up or a regenerated answer", async () => {
  const t = await ownerTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "two-tabs",
      url: "https://example.com/two-tabs",
      title: "Two tabs",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  const a0 = { role: "assistant" as const, content: "First answer." };
  const u1 = { role: "user" as const, content: "And then?" };
  const a1 = { role: "assistant" as const, content: "Then this." };
  const threadId = await t.mutation(api.companionThreads.create, {
    articleId,
    mode: "explain",
    selection: "tabs",
    turns: [a0],
  });
  // Tab A asks a follow-up
  await t.mutation(api.companionThreads.updateTurns, {
    threadId,
    turns: [a0, u1, a1],
  });
  // Tab B never saw it and asks its own: same length, different turns
  await expect(
    t.mutation(api.companionThreads.updateTurns, {
      threadId,
      turns: [
        a0,
        { role: "user", content: "Something else?" },
        { role: "assistant", content: "Other." },
      ],
    }),
  ).rejects.toThrow("This answer changed in another tab. Reload to see it.");
  // Or sends what it had, which is shorter
  await expect(
    t.mutation(api.companionThreads.updateTurns, { threadId, turns: [a0] }),
  ).rejects.toThrow("changed in another tab");
  // Tab A regenerates the last answer, then asks again
  const regenerated = { role: "assistant" as const, content: "Then that." };
  await t.mutation(api.companionThreads.updateTurns, {
    threadId,
    turns: [a0, u1, regenerated],
  });
  await t.mutation(api.companionThreads.updateTurns, {
    threadId,
    turns: [a0, u1, regenerated, u1, a1],
  });
  const [saved] = await t.query(api.companionThreads.listByArticle, {
    articleId,
  });
  expect(saved.turns.map((turn) => turn.content)).toEqual([
    "First answer.",
    "And then?",
    "Then that.",
    "And then?",
    "Then this.",
  ]);
});
