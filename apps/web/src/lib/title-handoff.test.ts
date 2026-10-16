import { describe, expect, it } from "vitest";
import {
  arrivedFromFinish,
  articleTitleName,
  markFinished,
  rememberedTitle,
  rememberTitle,
} from "./title-handoff";

describe("title handoff", () => {
  it("gives the reader the title the desk held, and nothing for a stranger", () => {
    rememberTitle("a1", "What a slow afternoon teaches");
    expect(rememberedTitle("a1")).toBe("What a slow afternoon teaches");
    expect(rememberedTitle("never-seen")).toBeUndefined();
  });

  it("names the desk title and the reader heading the same, per article", () => {
    expect(articleTitleName("a1")).toBe("article-title-a1");
    expect(articleTitleName("a1")).not.toBe(articleTitleName("a2"));
  });

  it("treats the desk as arriving from a finish for a few seconds, and reads the same twice", () => {
    markFinished(1_000);
    expect(arrivedFromFinish(1_500)).toBe(true);
    expect(arrivedFromFinish(1_500)).toBe(true);
    expect(arrivedFromFinish(1_000 + 5_000)).toBe(false);
  });
});
