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
