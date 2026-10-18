import { describe, expect, it } from "vitest";
import { chunkNote, MAX_CHUNK_BYTES } from "./chunker";

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
  it.each([
    "x".repeat(100_000),
    "世界🙂。".repeat(5000),
    "word ".repeat(20_000),
  ])("splits an oversize paragraph without dropping body text", (body) => {
    const prefix = "Note > Topic:\n";
    const chunks = chunkNote("Note", `## Topic\n${body}`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every(
        (chunk) => Buffer.byteLength(chunk.content, "utf8") <= MAX_CHUNK_BYTES,
      ),
    ).toBe(true);
    expect(
      chunks.map((chunk) => chunk.content.slice(prefix.length)).join(""),
    ).toBe(body.trim());
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
      chunks.map((_, index) => index),
    );
  });
  it("counts heading overhead and keeps short sections", () => {
    const chunks = chunkNote(
      "N".repeat(200),
      `## First\nShort.\n## Second\n${"y".repeat(6400)}`,
    );
    expect(chunks[0].content).toContain("Short.");
    expect(
      chunks.every(
        (chunk) => Buffer.byteLength(chunk.content) <= MAX_CHUNK_BYTES,
      ),
    ).toBe(true);
    expect(() => chunkNote("N".repeat(3200), "Body")).toThrow("context budget");
  });
  it("does not silently drop heading-only or consecutive empty sections", () => {
    expect(chunkNote("Note", "## Only")[0].content).toBe("Note > Only:\nOnly");
    const chunks = chunkNote("Note", "## First\n## Second\nA short body.");
    expect(chunks.map((chunk) => chunk.heading)).toEqual(["First", "Second"]);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
    expect(chunks[1].content).toContain("A short body.");
  });
});
