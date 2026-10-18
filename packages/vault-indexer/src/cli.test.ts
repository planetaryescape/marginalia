import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("runs the actual dry-run CLI against an isolated local fixture without credentials or writes", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "marginalia-cli-fixture-"));
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        version: 2,
        hashes: { "Removed.md": "old" },
        cursor: null,
      }),
    );
  });
  try {
    await writeFile(join(fixture, "New.md"), "A synthetic thought.");
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Fixture server did not bind");
    const child = spawn(
      "bun",
      ["run", "src/index.ts", "--vault", fixture, "--dry-run"],
      {
        env: {
          PATH: process.env.PATH,
          CONVEX_SITE_URL: `http://127.0.0.1:${address.port}`,
          VAULT_INDEXER_API_KEY: "synthetic-fixture",
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toContain("Would update: New.md");
    expect(stdout).toContain("Would delete indexed chunks: Removed.md");
    expect(stdout).toContain("Dry run (no embeddings or writes)");
    expect(requests).toEqual(["GET /api/vault/hashes?protocol=2"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(fixture, { recursive: true, force: true });
  }
});
