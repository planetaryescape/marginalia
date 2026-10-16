import { describe, expect, it } from "vitest";
import { citedIds, MAX_CITED } from "./cited-ids";

describe("citedIds", () => {
  it("finds article links once each, in order", () => {
    expect(
      citedIds(
        "Try [A](/read/abc123) then [B](/read/def456), and [A again](/read/abc123).",
      ),
    ).toEqual(["abc123", "def456"]);
  });

  it("ignores other links and plain text", () => {
    expect(
      citedIds("See [site](https://example.com/read/xyz) or /read/nope."),
    ).toEqual([]);
  });

  it("reads a link that carries a query string", () => {
    expect(citedIds("[A](/read/abc?quote=hi)")).toEqual(["abc"]);
  });

  it("is bounded", () => {
    const text = Array.from({ length: 20 }, (_, i) => `[t](/read/id${i})`).join(
      " ",
    );
    expect(citedIds(text)).toHaveLength(MAX_CITED);
  });
});
