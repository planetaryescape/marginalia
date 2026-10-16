import { describe, expect, it } from "vitest";
import {
  addTally,
  entityAffinity,
  evidenceOf,
  feedAffinities,
  MIN_REASON,
  normaliseAuthor,
  PROFILE_CAP,
  TASTE_MAX,
  type Tally,
  tallyEntries,
  tasteOf,
  whyLine,
} from "./taste";

describe("entityAffinity", () => {
  it("says little about one article and more about many", () => {
    expect(entityAffinity(1, 0)).toBeCloseTo(0.25);
    expect(entityAffinity(10, 0)).toBeGreaterThan(0.7);
    expect(entityAffinity(10, 0)).toBeLessThan(1);
  });

  it("is negative for what is passed over and zero for no evidence", () => {
    expect(entityAffinity(0, 4)).toBeLessThan(0);
    expect(entityAffinity(0, 0)).toBe(0);
  });
});

describe("feedAffinities", () => {
  const feed = (
    feedId: string,
    offered: number,
    opened: number,
    finished: number,
  ) => ({ feedId, offered, opened, finished });

  it("ranks a feed read often above one almost never opened", () => {
    const entries = feedAffinities([
      feed("loved", 40, 30, 24),
      feed("ignored", 40, 1, 0),
      feed("middling", 40, 10, 5),
    ]);
    const at = (key: string) =>
      entries.find((e) => e.key === key)?.affinity ?? 0;
    expect(at("loved")).toBeGreaterThan(at("middling"));
    expect(at("middling")).toBeGreaterThan(at("ignored"));
    expect(at("loved")).toBeGreaterThan(0);
    expect(at("ignored")).toBeLessThan(0);
  });

  it("holds a feed with few offers near the reader's own rate", () => {
    const entries = feedAffinities([
      feed("steady", 100, 30, 15),
      feed("new", 1, 0, 0),
    ]);
    const fresh = entries.find((e) => e.key === "new");
    expect(Math.abs(fresh?.affinity ?? 0)).toBeLessThan(0.1);
  });

  it("gives nothing when nothing was offered", () => {
    expect(feedAffinities([feed("none", 0, 0, 0)])).toEqual([]);
    expect(feedAffinities([])).toEqual([]);
  });
});

describe("evidenceOf", () => {
  const none = {
    finished: false,
    opened: false,
    skipped: false,
    loved: false,
  };

  it("counts a finish above an open, and a skip against", () => {
    expect(evidenceOf({ ...none, finished: true, opened: true })).toEqual({
      pos: 1,
      neg: 0,
    });
    expect(evidenceOf({ ...none, opened: true })).toEqual({ pos: 0.4, neg: 0 });
    expect(evidenceOf({ ...none, skipped: true })).toEqual({ pos: 0, neg: 1 });
  });

  it("does not hold a skip against an article that was then opened", () => {
    expect(evidenceOf({ ...none, opened: true, skipped: true }).neg).toBe(0);
  });

  it("adds loves and ratings", () => {
    expect(evidenceOf({ ...none, finished: true, loved: true }).pos).toBe(2);
    expect(evidenceOf({ ...none, opened: true, rating: 5 }).pos).toBeCloseTo(
      0.9,
    );
    expect(evidenceOf({ ...none, opened: true, rating: 2 }).neg).toBe(1);
    expect(evidenceOf({ ...none, opened: true, rating: 3 })).toEqual({
      pos: 0.4,
      neg: 0,
    });
  });
});

describe("tallyEntries", () => {
  it("keeps the strongest entries up to the cap, deterministically", () => {
    const tally: Tally = {};
    for (let i = 0; i < PROFILE_CAP + 20; i++)
      addTally(tally, `author ${String(i).padStart(3, "0")}`, {
        pos: 1 + (i % 7),
        neg: 0,
      });
    const entries = tallyEntries(tally);
    expect(entries).toHaveLength(PROFILE_CAP);
    for (let i = 1; i < entries.length; i++)
      expect(Math.abs(entries[i - 1].affinity)).toBeGreaterThanOrEqual(
        Math.abs(entries[i].affinity),
      );
    expect(tallyEntries(tally)).toEqual(entries);
  });

  it("drops entries that say nothing", () => {
    const tally: Tally = {};
    addTally(tally, "even", { pos: 5, neg: 5 });
    addTally(tally, "none", { pos: 0, neg: 0 });
    expect(tallyEntries(tally)).toEqual([]);
  });
});

describe("normaliseAuthor", () => {
  it("spells one author one way", () => {
    expect(normaliseAuthor("  Ada   Lovelace ")).toBe("ada lovelace");
    expect(normaliseAuthor(undefined)).toBeUndefined();
    expect(normaliseAuthor("   ")).toBeUndefined();
  });
});

describe("tasteOf", () => {
  const profile = {
    feeds: [{ key: "feed1", affinity: 0.8, n: 20 }],
    authors: [{ key: "ada lovelace", affinity: 0.7, n: 6 }],
    tags: [
      { key: "tagA", affinity: 0.5, n: 4 },
      { key: "tagB", affinity: -0.9, n: 5 },
    ],
  };

  it("is zero without a profile or any matching signal", () => {
    expect(tasteOf(null, { tagIds: [] }).term).toBe(0);
    expect(
      tasteOf(profile, { feedId: "other", author: "Nobody", tagIds: ["z"] }),
    ).toEqual({ term: 0 });
  });

  it("stays within -1 and 1 however strong the signals", () => {
    const loud = tasteOf(profile, {
      feedId: "feed1",
      author: "Ada Lovelace",
      tagIds: ["tagA"],
    });
    expect(loud.term).toBe(1);
    expect(loud.term * TASTE_MAX).toBeLessThanOrEqual(TASTE_MAX);
    const dull = tasteOf(
      {
        feeds: [{ key: "f", affinity: -1, n: 9 }],
        authors: [{ key: "x", affinity: -1, n: 9 }],
        tags: [{ key: "t", affinity: -1, n: 9 }],
      },
      { feedId: "f", author: "x", tagIds: ["t"] },
    );
    expect(dull.term).toBe(-1);
  });

  it("names the strongest positive signal as the reason", () => {
    expect(
      tasteOf(profile, {
        feedId: "feed1",
        author: "ada lovelace",
        tagIds: ["tagA"],
      }).because,
    ).toEqual({ source: "author", key: "ada lovelace" });
    expect(tasteOf(profile, { feedId: "feed1", tagIds: [] }).because).toEqual({
      source: "feed",
      key: "feed1",
    });
  });

  it("gives no reason for a signal against, or one too weak to mention", () => {
    expect(tasteOf(profile, { tagIds: ["tagB"] }).because).toBeUndefined();
    const weak = tasteOf(
      {
        feeds: [{ key: "f", affinity: MIN_REASON / 2, n: 3 }],
        authors: [],
        tags: [],
      },
      { feedId: "f", tagIds: [] },
    );
    expect(weak.because).toBeUndefined();
  });

  it("lets the most extreme tag speak for the topic", () => {
    const t = tasteOf(profile, { tagIds: ["tagA", "tagB"] });
    expect(t.term).toBeLessThan(0);
  });
});

describe("whyLine", () => {
  it("speaks plainly, with no scores or mention of a model", () => {
    const lines = [
      whyLine({ source: "author", key: "a" }),
      whyLine({ source: "feed", key: "f" }),
      whyLine({ source: "tag", key: "t" }, "attention"),
    ];
    expect(lines).toEqual([
      "You usually finish pieces like this from this writer.",
      "You usually read what this source sends.",
      "You often finish pieces on attention.",
    ]);
    for (const line of lines)
      expect(line).not.toMatch(/\d|\bAI\b|recommend|score/i);
  });

  it("says nothing about a topic it cannot name", () => {
    expect(whyLine({ source: "tag", key: "t" })).toBeUndefined();
  });
});
