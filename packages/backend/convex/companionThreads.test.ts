/// <reference types="vite/client" />

import { expect, it } from "vitest";
import { ownerTest } from "../test/owner";
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
