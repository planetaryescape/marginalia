import { beforeEach, describe, expect, it, vi } from "vitest";

const embedded = vi.hoisted(() => ({ inputs: [] as string[] }));
vi.mock("./embeddings", () => ({
  embedText: async (_target: unknown, text: string) => {
    embedded.inputs.push(text);
    return [text.length];
  },
}));

import type { ActionCtx } from "../_generated/server";
import { buildLibraryContext, libraryRetrievalQuery } from "./library";

const history = [
  { role: "user" as const, content: "my notes on Attention Is All You Need" },
  { role: "assistant" as const, content: "You wrote two notes [x](/read/a1)." },
];

/**
 * A library where the notes surface only when the search text mentions the
 * paper, as a vector search would for a question about it.
 */
function fakeCtx() {
  return {
    vectorSearch: async (table: string, _index: string, opts: unknown) => {
      const { vector } = opts as { vector: number[] };
      const mentionsPaper = vector[0] > 20;
      if (table === "userNotes" && mentionsPaper) return [{ _id: "n1" }];
      if (table === "highlights" && mentionsPaper) return [{ _id: "h1" }];
      return [];
    },
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.noteIds !== undefined)
        return {
          impressions: [],
          threads: [],
          notes: (args.noteIds as string[]).map((id) => ({
            _id: id,
            articleId: "a1",
            contentPlain: "Attention replaces recurrence",
          })),
          highlights: (args.highlightIds as string[]).map((id) => ({
            _id: id,
            articleId: "a1",
            text: "self-attention",
          })),
        };
      if (args.articleIds !== undefined)
        return (args.articleIds as string[]).map((id) => ({
          _id: id,
          title: "Attention Is All You Need",
          url: "https://arxiv.org/abs/1706.03762",
          createdAt: 0,
        }));
      return { impressions: [], interactions: [] };
    },
  } as unknown as ActionCtx;
}

describe("librarian retrieval for follow-ups", () => {
  beforeEach(() => {
    embedded.inputs = [];
  });

  it("searches a vague follow-up together with what was asked before", () => {
    const query = libraryRetrievalQuery("anything else", history);
    expect(query).toContain("Attention Is All You Need");
    expect(query.endsWith("anything else")).toBe(true);
    expect(libraryRetrievalQuery("first", [])).toBe("first");
  });

  it("gives a follow-up the same notes and highlights as the first question", async () => {
    const embedder = { model: "m" } as never;
    const first = await buildLibraryContext(
      fakeCtx(),
      "u",
      "my notes on Attention Is All You Need",
      embedder,
    );
    const followUp = await buildLibraryContext(
      fakeCtx(),
      "u",
      "anything else",
      embedder,
      history,
    );
    expect(first).toContain("Their note: Attention replaces recurrence");
    expect(followUp).toContain("Their note: Attention replaces recurrence");
    expect(followUp).toContain('They highlighted: "self-attention"');
  });

  it("loses them when only the vague follow-up is searched", async () => {
    const alone = await buildLibraryContext(fakeCtx(), "u", "anything else", {
      model: "m",
    } as never);
    expect(alone).not.toContain("Their note:");
  });
});
