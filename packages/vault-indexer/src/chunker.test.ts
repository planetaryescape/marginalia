import { describe, expect, it } from "vitest";
import { chunkNote } from "./chunker";

describe("vault chunking", () => {
  it("ignores empty notes but indexes a short single-section note", () => {
    expect(chunkNote("Note", " \n ")).toEqual([]);
    expect(chunkNote("Note", "A short thought.")).toEqual([
      {
        content: "Note > Introduction:\nA short thought.",
        chunkIndex: 0,
        heading: "Introduction",
      },
    ]);
  });
  it("keeps heading context and consecutive indices when splitting paragraphs", () => {
    const paragraphs = ["a".repeat(2000), "b".repeat(2000), "c".repeat(2000)];
    const chunks = chunkNote("Note", `## Topic\n${paragraphs.join("\n\n")}`);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
    expect(
      chunks.every(
        (chunk) =>
          chunk.heading === "Topic" &&
          chunk.content.startsWith("Note > Topic:\n"),
      ),
    ).toBe(true);
    paragraphs.forEach((paragraph, index) => {
      expect(chunks[index].content).toContain(paragraph);
    });
  });
});
