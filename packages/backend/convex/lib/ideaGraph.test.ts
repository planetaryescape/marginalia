import { describe, expect, it } from "vitest";
import {
  Candidates,
  cleanReason,
  linkedReason,
  nodeKey,
  pairFingerprint,
  pairKey,
  parseKey,
  similarityReason,
  tagReason,
} from "./ideaGraph";

describe("node keys", () => {
  it("round-trips a key and rejects anything else", () => {
    expect(parseKey(nodeKey("vault", "abc:def"))).toEqual({
      kind: "vault",
      id: "abc:def",
    });
    for (const bad of ["", "note", "note:", ":abc", "article:abc", "x"])
      expect(parseKey(bad)).toBeNull();
  });

  it("names a pair the same whichever way round", () => {
    expect(pairKey("note:a", "note:b")).toBe(pairKey("note:b", "note:a"));
  });
});

describe("candidates", () => {
  it("adds up distinct reasons, ignores repeats and the centre itself", () => {
    const found = new Candidates("note:me");
    found.add("note:a", tagReason("focus"));
    found.add("note:a", tagReason("focus"));
    found.add("note:a", linkedReason());
    found.add("note:b", similarityReason());
    found.add("note:me", linkedReason());
    expect(found.ranked(10).map((c) => [c.key, c.score])).toEqual([
      ["note:a", 125],
      ["note:b", 60],
    ]);
    expect(found.ranked(1)).toHaveLength(1);
  });

  it("orders ties by key so the map doesn't shuffle", () => {
    const found = new Candidates("note:me");
    found.add("note:z", linkedReason());
    found.add("note:a", linkedReason());
    expect(found.ranked(2).map((c) => c.key)).toEqual(["note:a", "note:z"]);
  });
});

describe("pairFingerprint", () => {
  const a = { key: "note:a", text: "one" };
  const b = { key: "note:b", text: "two" };
  it("ignores the order of the pair but notices an edit", () => {
    expect(pairFingerprint(a, b)).toBe(pairFingerprint(b, a));
    expect(pairFingerprint(a, b)).not.toBe(
      pairFingerprint({ ...a, text: "one!" }, b),
    );
  });
});

describe("cleanReason", () => {
  it("keeps one plain sentence", () => {
    expect(cleanReason('  "Both  are about\nfocus."  ')).toBe(
      "Both are about focus.",
    );
  });
});
