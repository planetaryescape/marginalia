import { describe, expect, it } from "vitest";
import {
  dedupeMatches,
  previousPosition,
  strongTitleMatch,
  type TopicMatch,
  titleFirst,
  topicCard,
} from "./topic-card";

const match = (articleId: string, minutes: number | null): TopicMatch => ({
  articleId,
  title: `Title ${articleId}`,
  author: null,
  source: null,
  minutes,
  status: "Up next",
});
const all = [match("a", 12), match("b", 7), match("c", null), match("d", 4)];

describe("topic cards", () => {
  it("offers every match in rank order when no time is chosen", () => {
    const first = topicCard(all, 0, null);
    expect(first).toMatchObject({
      kind: "card",
      index: 0,
      ordinal: 1,
      total: 4,
    });
    expect(topicCard(all, 1, null)).toMatchObject({ index: 1, ordinal: 2 });
  });

  it("offers only matches that fit the chosen time, never ones of unknown length", () => {
    expect(topicCard(all, 0, 10)).toMatchObject({
      match: { articleId: "b" },
      ordinal: 1,
      total: 2,
      hasNext: true,
    });
    expect(topicCard(all, 2, 10)).toMatchObject({ match: { articleId: "d" } });
    expect(topicCard(all, 4, 10)).toEqual({ kind: "end", count: 2 });
  });

  it("includes a match that is exactly as long as the time", () => {
    expect(topicCard(all, 0, 7)).toMatchObject({ match: { articleId: "b" } });
  });

  it("names the shortest match when none fits", () => {
    expect(topicCard(all, 0, 3)).toMatchObject({
      kind: "none-fit",
      shortest: { articleId: "d" },
    });
    expect(topicCard([match("x", null)], 0, 3)).toEqual({
      kind: "none-fit",
      shortest: null,
    });
  });

  it("is empty with no matches", () => {
    expect(topicCard([], 0, null)).toEqual({ kind: "empty" });
  });

  it("steps back to the previous offered card only", () => {
    expect(previousPosition(all, 3, 10)).toBe(1);
    expect(previousPosition(all, 1, 10)).toBe(1);
  });

  it("drops a repeated article", () => {
    expect(
      dedupeMatches([all[0], all[1], all[0]]).map((m) => m.articleId),
    ).toEqual(["a", "b"]);
  });
});

describe("strong title match", () => {
  const titled = (articleId: string, title: string): TopicMatch => ({
    ...match(articleId, 5),
    title,
  });
  const candidates = [
    titled("a", "Slow cheese making"),
    titled("b", "Fast Wine, slow cheese"),
  ];

  it("needs every typed word of three letters or more in the title, ignoring case", () => {
    expect(strongTitleMatch("SLOW cheese", candidates)?.articleId).toBe("a");
    expect(strongTitleMatch("wine cheese", candidates)?.articleId).toBe("b");
    expect(strongTitleMatch("slow bread", candidates)).toBeNull();
  });

  it("accepts an unfinished last word but not a word inside another", () => {
    expect(strongTitleMatch("slow chee", candidates)?.articleId).toBe("a");
    expect(strongTitleMatch("eese", candidates)).toBeNull();
  });

  it("ignores words under three letters, and needs at least one longer", () => {
    expect(strongTitleMatch("on slow", candidates)?.articleId).toBe("a");
    expect(strongTitleMatch("on to", candidates)).toBeNull();
    expect(strongTitleMatch("  ", candidates)).toBeNull();
  });

  it("takes the first candidate in the order given", () => {
    expect(strongTitleMatch("cheese", candidates)?.articleId).toBe("a");
  });

  it("keeps the title match first and drops its second copy", () => {
    const first = titled("t", "Slow cheese making");
    const ranked = [all[0], { ...first }, all[1], all[0]];
    expect(titleFirst(first, ranked).map((m) => m.articleId)).toEqual([
      "t",
      "a",
      "b",
    ]);
  });

  it("treats another saved copy of the title match's page as the same card", () => {
    const first = {
      ...titled("t", "Slow cheese making"),
      url: "https://x.test/p",
    };
    const copy = { ...all[1], url: "https://x.test/p" };
    expect(
      titleFirst(first, [copy, { ...all[0], url: "https://x.test/a" }]).map(
        (m) => m.articleId,
      ),
    ).toEqual(["t", "a"]);
  });

  it("is just the ranking when there is no title match", () => {
    expect(titleFirst(null, [all[0], all[0], all[1]])).toEqual([
      all[0],
      all[1],
    ]);
  });
});
