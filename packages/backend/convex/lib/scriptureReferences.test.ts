import { describe, expect, it } from "vitest";
import {
  citedScriptureReferences,
  referenceFromKey,
} from "./scriptureReferences";

describe("conservative Scripture reference recognition", () => {
  it.each([
    ["JHN.1.1-JHN.1.2", "John 1:1-2"],
    ["1JN.1", "1 John 1"],
    ["PSA.23", "Psalms 23"],
  ])("parses %s as %s", (key, reference) => {
    expect(referenceFromKey(key)?.reference).toBe(reference);
  });

  it.each([
    "JHN.1.1-JHN.2.3",
    "JHN.1.1-2.3",
    "JHN.1.1-JHN.1.2.3",
    "JHN.1.1-extra",
    "JHN.1.1-JHN.1.2-junk",
  ])("rejects malformed or cross-chapter key %s", (key) => {
    expect(referenceFromKey(key)).toBeNull();
  });

  it("does not salvage the valid prefix of a cross-chapter citation", () => {
    expect(citedScriptureReferences("John 1:1-2:3")).toEqual([]);
    expect(
      citedScriptureReferences("1 John 1:1 and Psalm 23").map(
        (ref) => ref.reference,
      ),
    ).toEqual(["1 John 1:1", "Psalms 23"]);
  });
});
