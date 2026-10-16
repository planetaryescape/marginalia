import { describe, expect, it } from "vitest";
import {
  dedupeMatches,
  previousPosition,
  type TopicMatch,
  topicCard,
} from "./topic-card";

const match = (articleId: string, minutes: number | null): TopicMatch => ({
  articleId,
  title: `Title ${articleId}`,
  author: null,
  source: null,
  minutes,
  status: "Unread",
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
