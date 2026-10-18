import { describe, expect, it, vi } from "vitest";
import { HttpError } from "./network";
import type { VaultNote } from "./reader";
import { syncVault } from "./sync";

const note = (filePath: string, hash = "new"): VaultNote => ({
  filePath,
  fileName: filePath,
  hash,
  content: "A thought",
  tags: [],
});
async function* notes(items: VaultNote[]) {
  yield* items;
}
const embed = async (texts: string[]) =>
  texts.map((_, index) => ({ index, embedding: Array(1536).fill(0.1) }));

describe("bounded file checkpoints", () => {
  it("uploads each complete file before reading the next and retains one group", async () => {
    let uploaded = 0;
    const retained: number[] = [];
    async function* source() {
      for (let i = 0; i < 100; i++) {
        expect(uploaded).toBe(i);
        yield note(`${i}.md`);
      }
    }
    const result = await syncVault(
      source(),
      {},
      {
        embed,
        replace: async () => {
          uploaded++;
        },
        remove: vi.fn(),
        retainedGroups: (n) => retained.push(n),
      },
    );
    expect(result).toEqual({
      updated: 100,
      unchanged: 0,
      removed: 0,
      failed: 0,
    });
    expect(Math.max(...retained)).toBe(1);
    expect(retained).toEqual(Array.from({ length: 100 }, () => [1, 0]).flat());
  });
  it("preserves incomplete/failed files, checkpoints neighbors, then resumes only unfinished files", async () => {
    const remote = { "A.md": "old", "B.md": "old", "C.md": "old" };
    const replace = vi.fn(async (path: string) => {
      if (path === "C.md") throw new Error("offline");
      remote["B.md"] = "new";
    });
    const partial = vi.fn().mockResolvedValueOnce([]).mockImplementation(embed);
    expect(
      await syncVault(
        notes([note("A.md"), note("B.md"), note("C.md")]),
        remote,
        { embed: partial, replace, remove: vi.fn() },
      ),
    ).toEqual({ updated: 1, unchanged: 0, failed: 2, removed: 0 });
    expect(replace.mock.calls.map(([path]) => path)).toEqual(["B.md", "C.md"]);
    const resumed = vi.fn();
    await syncVault(notes([note("A.md"), note("B.md"), note("C.md")]), remote, {
      embed,
      replace: resumed,
      remove: vi.fn(),
    });
    expect(resumed.mock.calls.map(([path]) => path)).toEqual(["A.md", "C.md"]);
  });
  it("does no provider/write work on no-change or dry-run, but previews removals", async () => {
    const write = vi.fn();
    const provider = vi.fn();
    const log = vi.fn();
    const unchanged = await syncVault(
      notes([note("A.md")]),
      { "A.md": "new" },
      { embed: provider, replace: write, remove: write },
    );
    expect(unchanged.unchanged).toBe(1);
    const preview = await syncVault(
      notes([note("A.md")]),
      { "Gone.md": "old" },
      { dryRun: true, embed: provider, replace: write, remove: write, log },
    );
    expect(preview).toEqual({
      updated: 1,
      unchanged: 0,
      removed: 1,
      failed: 0,
    });
    expect(provider).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Would delete indexed chunks: Gone.md");
  });
  it("does not remove anything after a partial scan or interruption; prior checkpoints survive", async () => {
    const replace = vi.fn();
    const remove = vi.fn();
    async function* broken() {
      yield note("A.md");
      throw new Error("scan failed");
    }
    await expect(
      syncVault(broken(), { "Gone.md": "old" }, { embed, replace, remove }),
    ).rejects.toThrow("scan failed");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    const controller = new AbortController();
    await expect(
      syncVault(
        notes([note("B.md"), note("C.md")]),
        {},
        {
          signal: controller.signal,
          embed: async (texts) => {
            controller.abort(new Error("stop"));
            return embed(texts);
          },
          replace,
          remove,
        },
      ),
    ).rejects.toThrow("stop");
    expect(replace).toHaveBeenCalledTimes(1);
  });
  it("stops the run on shared permanent authentication failure", async () => {
    const provider = vi.fn(async () => {
      throw new HttpError(401);
    });
    await expect(
      syncVault(
        notes([note("A"), note("B")]),
        {},
        { embed: provider, replace: vi.fn(), remove: vi.fn() },
      ),
    ).rejects.toThrow("401");
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
