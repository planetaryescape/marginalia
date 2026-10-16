import { describe, expect, it } from "vitest";
import { groupByArticle } from "./notes-groups";

const note = (articleId: string, updatedAt: number) =>
  ({ _id: `n${updatedAt}`, articleId, updatedAt }) as never;
const kept = (articleId: string, keptAt: number) =>
  ({ _id: `t${keptAt}`, articleId, keptAt, updatedAt: 1 }) as never;

describe("groupByArticle", () => {
  it("groups notes and kept answers under one article, newest article first", () => {
    const groups = groupByArticle(
      [note("a", 10), note("a", 5), note("b", 30)],
      [kept("a", 20), kept("c", 40), kept("a", 15)],
    );
    expect(groups.map((g) => g.articleId)).toEqual(["c", "b", "a"]);
    const a = groups.find((g) => g.articleId === "a");
    expect(a?.notes).toHaveLength(2);
    expect(a?.answers).toHaveLength(2);
  });
  it("lets a kept answer alone make a group", () => {
    expect(groupByArticle([], [kept("a", 1)])).toHaveLength(1);
    expect(groupByArticle([], [])).toEqual([]);
  });
});
