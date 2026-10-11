import { describe, expect, it } from "vitest";
import { parseEmbeddings } from "./embeddings";

const vector = (value: number) => Array.from({ length: 1536 }, () => value);

describe("embedding response validation", () => {
  it("restores request order when the provider returns vectors out of order", () => {
    expect(
      parseEmbeddings(
        {
          data: [
            { index: 1, embedding: vector(2) },
            { index: 0, embedding: vector(1) },
          ],
        },
        2,
      ),
    ).toEqual([vector(1), vector(2)]);
  });
  it.each([
    { data: [] },
    { data: [{ index: 0, embedding: [1, 2] }] },
    { data: [{ index: 2, embedding: vector(1) }] },
    { data: [{ index: 0, embedding: vector(Number.NaN) }] },
    {
      data: [
        { index: 0, embedding: vector(1) },
        { index: 0, embedding: vector(2) },
      ],
    },
  ])("rejects missing, malformed or duplicated vectors", (body) => {
    expect(() => parseEmbeddings(body, 1)).toThrow();
  });
});
