import { describe, expect, it } from "vitest";
import {
  librarySearchRequestSchema,
  parseLibrarySearch,
  type SearchCandidate,
} from "./librarySearch";

const candidates: SearchCandidate[] = [
  {
    articleId: "a1",
    title: "Cows and methane",
    url: "https://example.com/cows",
    author: "Ann",
    minutes: 8,
    status: "Unread",
  },
  {
    articleId: "a2",
    title: "Another saved copy",
    url: "https://example.com/cows/#section",
    author: null,
    minutes: 8,
    status: "Read",
  },
  {
    articleId: "b1",
    title: "Science of sleep",
    url: "https://example.com/sleep",
    author: null,
    minutes: 5,
    status: "Started",
  },
];

describe("library search result validation", () => {
  it("uses database metadata and model ranking, not invented titles", () => {
    expect(
      parseLibrarySearch(
        JSON.stringify({
          matches: [
            { articleId: "b1", reason: "A short read about sleep." },
            { articleId: "a1", reason: "Explains cattle emissions." },
          ],
        }),
        candidates,
      ),
    ).toEqual([
      {
        articleId: "b1",
        title: "Science of sleep",
        author: null,
        minutes: 5,
        status: "Started",
        reason: "A short read about sleep.",
      },
      {
        articleId: "a1",
        title: "Cows and methane",
        author: "Ann",
        minutes: 8,
        status: "Unread",
        reason: "Explains cattle emissions.",
      },
    ]);
  });
  it("drops unknown IDs, repeated IDs and duplicate saved URLs", () => {
    const matches = parseLibrarySearch(
      JSON.stringify({
        matches: [
          { articleId: "invented", reason: "Not real." },
          { articleId: "a1", reason: "First match." },
          { articleId: "a1", reason: "Repeated ID." },
          { articleId: "a2", reason: "Duplicate URL." },
        ],
      }),
      candidates,
    );
    expect(matches.map((match) => match.articleId)).toEqual(["a1"]);
  });
  it("accepts an honest empty result and fenced JSON", () => {
    expect(
      parseLibrarySearch('```json\n{"matches":[]}\n```', candidates),
    ).toEqual([]);
  });
  it("keeps articles with malformed legacy URLs readable by ID", () => {
    const matches = parseLibrarySearch(
      '{"matches":[{"articleId":"a1","reason":"Explains cattle emissions."}]}',
      [{ ...candidates[0], url: "an old imported URL" }],
    );
    expect(matches).toEqual([
      {
        articleId: "a1",
        title: "Cows and methane",
        author: "Ann",
        minutes: 8,
        status: "Unread",
        reason: "Explains cattle emissions.",
      },
    ]);
  });
  it("rejects malformed results so another model can be tried", () => {
    for (const text of [
      "Not JSON",
      '{"matches":[{"articleId":"a1"}]}',
      '{"matches":[{"articleId":"a1","reason":""}]}',
    ])
      expect(() => parseLibrarySearch(text, candidates)).toThrow();
  });
  it("bounds and trims queries", () => {
    expect(
      librarySearchRequestSchema.parse({ question: "  science  " }).question,
    ).toBe("science");
    for (const question of [" ", "a", "a".repeat(2001)])
      expect(librarySearchRequestSchema.safeParse({ question }).success).toBe(
        false,
      );
  });
});
