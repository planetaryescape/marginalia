import { expect, it } from "vitest";
import { archiveFixture } from "../../test/accountArchive";
import { parseAccountArchive } from "./accountArchive";

it("projects an account archive without retaining source auth, jobs or caches", () => {
  const fixture = archiveFixture();
  const result = parseAccountArchive(fixture, "a".repeat(64));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Fixture rejected");
  expect(result.items).toHaveLength(1);
  expect(result.items[0].highlights).toHaveLength(1);
  expect(result.items[0].interactions).toHaveLength(1);
  expect(result.items[0].place).toEqual({ percent: 40, paragraphIndex: 2 });
  expect(result.items[0].article).not.toHaveProperty("libraryIndex");
});

it("refuses another library's attached records", () => {
  const fixture = archiveFixture();
  fixture.data.fullHighlights[0].rows[0].userId = "another-reader";
  expect(parseAccountArchive(fixture, "a".repeat(64))).toEqual({
    ok: false,
    reason: "inconsistent-export-identities",
  });
});

it("refuses incomplete highlight bodies instead of silently dropping marks", () => {
  const fixture = archiveFixture();
  fixture.data.fullHighlights = [];
  expect(parseAccountArchive(fixture, "a".repeat(64))).toMatchObject({
    ok: false,
  });
});

it("refuses unsupported nonempty records instead of claiming a complete import", () => {
  const fixture = archiveFixture();
  const input = {
    ...fixture,
    data: { ...fixture.data, notes: [{ text: "Must not disappear" }] },
  };
  expect(parseAccountArchive(input, "a".repeat(64))).toEqual({
    ok: false,
    reason: "unsupported-export-shape",
  });
});
