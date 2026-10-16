import { describe, expect, it } from "vitest";
import { groupByArticle, readLink } from "./notes-groups";

const note = (articleId: string, createdAt: number, updatedAt = createdAt) =>
  ({ _id: `n${createdAt}`, articleId, createdAt, updatedAt }) as never;
const kept = (articleId: string, keptAt: number) =>
  ({ _id: `t${keptAt}`, articleId, keptAt, updatedAt: 1 }) as never;
const mark = (articleId: string, createdAt: number, kind = "highlight") =>
  ({ _id: `h${createdAt}`, articleId, kind, text: "x", createdAt }) as never;

describe("groupByArticle", () => {
  it("groups notes, marks and kept answers under one article, newest activity first", () => {
    const groups = groupByArticle(
      [note("a", 10), note("a", 5), note("b", 30)],
      [kept("a", 20), kept("c", 40), kept("a", 15)],
      [mark("a", 12)],
    );
    expect(groups.map((g) => g.articleId)).toEqual(["c", "b", "a"]);
    const a = groups.find((g) => g.articleId === "a");
    expect(a?.items.map((i) => i.type)).toEqual([
      "note",
      "note",
      "mark",
      "answer",
      "answer",
    ]);
  });

  it("puts each article's items in the order they were made", () => {
    const [a] = groupByArticle(
      [note("a", 50), note("a", 10)],
      [kept("a", 30)],
      [mark("a", 20, "underline")],
    );
    expect(a.items.map((i) => i.at)).toEqual([10, 20, 30, 50]);
    expect(a.items[1]).toMatchObject({
      type: "mark",
      mark: { kind: "underline" },
    });
  });

  it("orders an article by a note's last edit, not when it was made", () => {
    const groups = groupByArticle([note("old", 1, 100), note("new", 50)], []);
    expect(groups.map((g) => g.articleId)).toEqual(["old", "new"]);
  });

  it("lets a kept answer or a mark alone make a group", () => {
    expect(groupByArticle([], [kept("a", 1)])).toHaveLength(1);
    expect(groupByArticle([], [], [mark("a", 1)])).toHaveLength(1);
    expect(groupByArticle([], [])).toEqual([]);
  });
});

describe("readLink", () => {
  it("opens the article, at a quote when there is one", () => {
    expect(readLink("art1" as never)).toBe("/read/art1");
    expect(readLink("art1" as never, "")).toBe("/read/art1");
    expect(readLink("art1" as never, "a & b")).toBe("/read/art1?quote=a+%26+b");
  });
});
