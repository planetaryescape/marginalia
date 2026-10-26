/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());
const key = "synthetic-vault-key";
const headers = { Authorization: `Bearer ${key}` };
const chunk = (userId: string, filePath: string) => ({
  userId,
  filePath,
  fileName: "Fixture",
  chunkIndex: 0,
  content: "Synthetic body",
  embedding: Array(1536).fill(0.1),
  fileHash: "fixture-hash",
  indexedAt: 1,
});

describe("vault hash HTTP authentication and compatibility", () => {
  it.each([
    "/api/vault/hashes",
    "/api/vault/hashes?protocol=2",
  ])("rejects missing/wrong/unconfigured API keys at %s", async (path) => {
    const t = convexTest({ schema, modules });
    vi.stubEnv("VAULT_INDEXER_API_KEY", key);
    for (const requestHeaders of [
      new Headers(),
      new Headers({ Authorization: "Bearer incorrect" }),
    ]) {
      const response = await t.fetch(path, { headers: requestHeaders });
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("Unauthorized");
    }
    vi.stubEnv("VAULT_INDEXER_API_KEY", "");
    expect((await t.fetch(path, { headers })).status).toBe(401);
    vi.stubEnv("VAULT_INDEXER_API_KEY", undefined);
    expect((await t.fetch(path, { headers })).status).toBe(401);
  });

  it("serves old and paginated contracts through the actual authenticated route before/after backfill", async () => {
    vi.stubEnv("VAULT_INDEXER_API_KEY", key);
    const t = convexTest({ schema, modules, transactionLimits: true });
    const paths = ["A.md", "笔记/世界.md", "$reserved.md"];
    await t.run(async (ctx) => {
      for (const path of paths)
        await ctx.db.insert("noteChunks", chunk("default_user", path));
      await ctx.db.insert("noteChunks", chunk("another-reader", "private.md"));
    });
    const expected = Object.fromEntries(
      paths.map((path) => [path, "fixture-hash"]),
    );
    const legacy = await t.fetch("/api/vault/hashes?userId=another-reader", {
      headers,
    });
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("Content-Type")).toContain("application/json");
    expect(await legacy.json()).toEqual(expected);

    const found: Record<string, string> = Object.create(null);
    let cursor: string | null = null;
    let requests = 0;
    do {
      const query = new URLSearchParams({
        protocol: "2",
        userId: "another-reader",
      });
      if (cursor !== null) query.set("cursor", cursor);
      const response = await t.fetch(`/api/vault/hashes?${query}`, { headers });
      expect(response.status).toBe(200);
      const page = await response.json();
      expect(page.version).toBe(2);
      Object.assign(found, page.hashes);
      cursor = page.cursor;
      requests++;
      expect(requests).toBeLessThanOrEqual(4);
    } while (cursor !== null);
    expect(found).toEqual(expected);

    for (let i = 0; i <= paths.length; i++)
      await t.mutation(internal.vaultFiles.backfill, {
        userId: "default_user",
      });
    const migrated = await t.fetch("/api/vault/hashes?protocol=2", { headers });
    expect(migrated.status).toBe(200);
    expect(await migrated.json()).toEqual({
      version: 2,
      hashes: expected,
      cursor: null,
    });
    expect(
      await (await t.fetch("/api/vault/hashes", { headers })).json(),
    ).toEqual(expected);
    expect(
      (
        await t.fetch("/api/vault/hashes?protocol=2", {
          headers: { Authorization: "Bearer incorrect" },
        })
      ).status,
    ).toBe(401);
  });
});
