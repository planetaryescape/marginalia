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
