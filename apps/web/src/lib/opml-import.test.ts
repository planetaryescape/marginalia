import { describe, expect, it, vi } from "vitest";
import {
  importOpmlBatches,
  type OpmlEntry,
  type OpmlProgress,
} from "./opml-import";

const progress = (count: number): OpmlProgress => ({
  entries: Array.from({ length: count }, (_, n) => ({
    url: `https://feed${n}.example/rss`,
    title: `Feed ${n}`,
  })),
  offset: 0,
  outcomes: [],
});
const acknowledge = (entries: OpmlEntry[]) =>
  entries.map((entry) => ({ url: entry.url, status: "created" as const }));
describe("OPML import batches", () => {
  it("imports 25 entries in three bounded acknowledgements with per-entry results", async () => {
    const p = progress(25);
    p.entries[12] = p.entries[0];
    p.entries[22] = { url: "invalid", title: "Invalid" };
    const send = vi.fn(async (entries: OpmlEntry[]) =>
      acknowledge(entries).map((o) =>
        o.url === "invalid" ? { ...o, status: "invalid" as const } : o,
      ),
    );
    await importOpmlBatches(p, send);
    expect(send.mock.calls.map(([batch]) => batch.length)).toEqual([10, 10, 5]);
    expect(p.offset).toBe(25);
    expect(p.outcomes[22].status).toBe("invalid");
  });
  it("resumes at the ambiguous batch, never replays acknowledged batches or hides a network failure as duplicates", async () => {
    const p = progress(25);
    const send = vi
      .fn(async (entries: OpmlEntry[]) => acknowledge(entries))
      .mockRejectedValueOnce(new Error("offline"));
    await expect(importOpmlBatches(p, send)).rejects.toThrow("offline");
    expect(p.offset).toBe(0);
    send
      .mockResolvedValueOnce(acknowledge(p.entries.slice(0, 10)))
      .mockRejectedValueOnce(new Error("lost ack"));
    await expect(importOpmlBatches(p, send)).rejects.toThrow("lost ack");
    expect(p.offset).toBe(10);
    await importOpmlBatches(p, send);
    expect(send.mock.calls.at(-2)?.[0][0].url).toBe(p.entries[10].url);
    expect(p.outcomes).toHaveLength(25);
  });
  it("splits by UTF-8 bytes and skips a giant entry with its own invalid outcome", async () => {
    const p = progress(12);
    p.entries = p.entries.map((e) => ({ ...e, title: "é".repeat(2000) }));
    p.entries.splice(2, 0, {
      url: "https://giant.example/rss",
      title: "x".repeat(40_000),
    });
    const send = vi.fn(async (entries: OpmlEntry[]) => acknowledge(entries));
    await importOpmlBatches(p, send);
    for (const [entries] of send.mock.calls)
      expect(
        new TextEncoder().encode(JSON.stringify(entries)).byteLength,
      ).toBeLessThanOrEqual(32768);
    expect(p.outcomes.filter((o) => o.status === "invalid")).toHaveLength(1);
    expect(p.outcomes).toHaveLength(13);
  });
});
