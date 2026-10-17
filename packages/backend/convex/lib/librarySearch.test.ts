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
    status: "Up next",
  },
  {
    articleId: "a2",
    title: "Another saved copy",
    url: "https://example.com/cows/#section",
    author: null,
    minutes: 8,
    status: "Finished",
  },
  {
    articleId: "b1",
    title: "Science of sleep",
    url: "https://example.com/sleep",
    author: null,
    minutes: 5,
    status: "Reading",
  },
];

describe("library search result validation", () => {
  it("omits a rejected article without discarding genuine matches", () => {
    const matches = parseLibrarySearch(
      JSON.stringify({
        matches: [
          {
            articleId: "a1",
            relevant: true,
            reason: "Not a match for life directly; omitted.",
          },
          {
            articleId: "b1",
            relevant: true,
            reason: "Explores the role of sleep in daily life.",
          },
        ],
      }),
      candidates,
    );
    expect(matches.map((match) => match.articleId)).toEqual(["b1"]);
  });
  it("uses database metadata and model ranking, not invented titles", () => {
    expect(
      parseLibrarySearch(
        JSON.stringify({
          matches: [
            {
              articleId: "b1",
              relevant: true,
              reason: "A short read about sleep.",
            },
            {
              articleId: "a1",
              relevant: true,
              reason: "Explains cattle emissions.",
            },
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
        status: "Reading",
        reason: "A short read about sleep.",
      },
      {
        articleId: "a1",
        title: "Cows and methane",
        author: "Ann",
        minutes: 8,
        status: "Up next",
        reason: "Explains cattle emissions.",
      },
    ]);
  });
  it("requires a positive relevance decision, not just a plausible reason", () => {
    expect(
      parseLibrarySearch(
        JSON.stringify({
          matches: [
            {
              articleId: "a1",
              relevant: false,
              reason: "A short unread article.",
            },
          ],
        }),
        candidates,
      ),
    ).toEqual([]);
  });
  it("lets a genuine saved copy follow a rejected copy of the same URL", () => {
    const matches = parseLibrarySearch(
      JSON.stringify({
        matches: [
          {
            articleId: "a1",
            relevant: true,
            reason: "Not relevant to this search.",
          },
          {
            articleId: "a2",
            relevant: true,
            reason: "Explores details omitted from the public debate.",
          },
        ],
      }),
      candidates,
    );
    expect(matches.map((match) => match.articleId)).toEqual(["a2"]);
  });
  it.each([
    "Not a direct match for life.",
    "Excluded: unrelated to life.",
    "Has no connection to this query; omitted.",
  ])("drops explicit exclusion text: %s", (reason) => {
    expect(
      parseLibrarySearch(
        JSON.stringify({
          matches: [{ articleId: "a1", relevant: true, reason }],
        }),
        candidates,
      ),
    ).toEqual([]);
  });
  it("drops unknown IDs, repeated IDs and duplicate saved URLs", () => {
    const matches = parseLibrarySearch(
      JSON.stringify({
        matches: [
          { articleId: "invented", relevant: true, reason: "Not real." },
          { articleId: "a1", relevant: true, reason: "First match." },
          { articleId: "a1", relevant: true, reason: "Repeated ID." },
          { articleId: "a2", relevant: true, reason: "Duplicate URL." },
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
      '{"matches":[{"articleId":"a1","relevant":true,"reason":"Explains cattle emissions."}]}',
      [{ ...candidates[0], url: "an old imported URL" }],
    );
    expect(matches).toEqual([
      {
        articleId: "a1",
        title: "Cows and methane",
        author: "Ann",
        minutes: 8,
        status: "Up next",
        reason: "Explains cattle emissions.",
      },
    ]);
  });
  it("rejects malformed results so another model can be tried", () => {
    for (const text of [
      "Not JSON",
      '{"matches":[{"articleId":"a1"}]}',
      '{"matches":[{"articleId":"a1","reason":""}]}',
      '{"matches":[{"articleId":"a1","reason":"A plausible but unverified match."}]}',
      '{"matches":[{"articleId":"a1","relevant":"false","reason":"A short read."}]}',
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
