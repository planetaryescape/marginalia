import { describe, expect, it } from "vitest";
import {
  cosine,
  isTopicKey,
  type KnownTag,
  matchTag,
  normaliseTag,
  tagDisplayName,
} from "./tagMatching";

/** A unit vector at `degrees` from [1, 0]: its cosine to [1, 0] is cos(degrees). */
const at = (degrees: number) => [
  Math.cos((degrees * Math.PI) / 180),
  Math.sin((degrees * Math.PI) / 180),
];
/** The angle whose cosine to the base vector is `similarity`. */
const withSimilarity = (similarity: number) =>
  at((Math.acos(similarity) * 180) / Math.PI);

const base = (extra: Partial<KnownTag> = {}): KnownTag => ({
  id: "t1",
  key: "hiring",
  aliases: [],
  embedding: at(0),
  ...extra,
});

describe("normaliseTag", () => {
  it.each([
    ["#Knowledge-Management", "knowledgemanagement"],
    ["areas/Knowledge Management", "knowledgemanagement"],
    ["knowledgemanagement", "knowledgemanagement"],
    ["resources/LLMs", "llm"],
    ["#projects/hiring/", "hiring"],
    ["Strategies", "strategy"],
    ["Boxes", "box"],
    ["business", "business"],
    ["bias", "bias"],
    ["news", "news"],
    ["AI", "ai"],
    ["  #  ", ""],
    ["///", ""],
  ])("%s -> %s", (raw, key) => {
    expect(normaliseTag(raw)).toBe(key);
  });

  it("treats prototype names as ordinary text", () => {
    expect(normaliseTag("constructor")).toBe("constructor");
    expect(normaliseTag("__proto__")).toBe("proto");
    expect(normaliseTag("toString")).toBe("tostring");
  });

  it("drops vault structure from a seed", () => {
    expect(isTopicKey(normaliseTag("#areas"))).toBe(false);
    expect(isTopicKey(normaliseTag("projects"))).toBe(false);
    expect(isTopicKey(normaliseTag("daily"))).toBe(false);
    expect(isTopicKey(normaliseTag("hiring"))).toBe(true);
    expect(isTopicKey("")).toBe(false);
  });

  it("names a tag by its leaf, in plain words", () => {
    expect(tagDisplayName("areas/Knowledge-Management")).toBe(
      "knowledge management",
    );
    expect(tagDisplayName("#LLMs")).toBe("llms");
  });
});

describe("cosine", () => {
  it("is 0 for mismatched or empty vectors", () => {
    expect(cosine([1, 0], [1])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
});

describe("matchTag", () => {
  it("matches an exact key", () => {
    expect(matchTag({ key: "hiring" }, [base()])).toEqual({
      kind: "existing",
      tagId: "t1",
    });
  });

  it("matches an alias without an embedding", () => {
    expect(
      matchTag({ key: "recruiting" }, [base({ aliases: ["recruiting"] })]),
    ).toEqual({ kind: "existing", tagId: "t1" });
  });

  it("merges at 0.90 and records the alias", () => {
    expect(
      matchTag({ key: "interviewing", embedding: withSimilarity(0.9) }, [
        base(),
      ]),
    ).toMatchObject({ kind: "existing", tagId: "t1", alias: "interviewing" });
  });

  it("makes a candidate linked to the nearest tag between 0.80 and 0.90", () => {
    for (const similarity of [0.8, 0.85, 0.899]) {
      expect(
        matchTag(
          { key: "interviewing", embedding: withSimilarity(similarity) },
          [base()],
        ),
      ).toEqual({ kind: "candidate", nearestTagId: "t1" });
    }
  });

  it("makes a plain new candidate below 0.80", () => {
    expect(
      matchTag({ key: "gardening", embedding: withSimilarity(0.79) }, [base()]),
    ).toEqual({ kind: "candidate" });
  });

  it("adds nothing it cannot compare", () => {
    expect(matchTag({ key: "gardening" }, [base()])).toEqual({ kind: "skip" });
  });

  it("starts a vocabulary with a candidate when there is nothing to compare to", () => {
    expect(matchTag({ key: "gardening", embedding: at(0) }, [])).toEqual({
      kind: "candidate",
    });
  });

  it("does not depend on the order tags are stored in", () => {
    const tags: KnownTag[] = [
      base({ id: "b", key: "one", embedding: at(0) }),
      base({ id: "a", key: "two", embedding: at(0) }),
      base({ id: "c", key: "three", embedding: at(40) }),
    ];
    const proposal = { key: "other", embedding: withSimilarity(0.95) };
    const forward = matchTag(proposal, tags);
    const backward = matchTag(proposal, [...tags].reverse());
    expect(forward).toEqual(backward);
    expect(forward).toMatchObject({ tagId: "a" });
  });

  it("treats a tag called constructor as an ordinary name", () => {
    const tags = [base({ key: "constructor", aliases: ["__proto__"] })];
    expect(matchTag({ key: "constructor" }, tags)).toMatchObject({
      kind: "existing",
    });
    expect(matchTag({ key: "__proto__" }, tags)).toMatchObject({
      kind: "existing",
    });
    expect(matchTag({ key: "hasownproperty" }, tags)).toEqual({ kind: "skip" });
  });
});
