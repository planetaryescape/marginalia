import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// Vault indexer endpoint — receives chunks from the local CLI
http.route({
  path: "/api/vault/upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Simple API key auth
    const authHeader = request.headers.get("Authorization");
    const expectedKey = process.env.VAULT_INDEXER_API_KEY;

    if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const { action, chunks, filePath } = body;

    if (action === "delete") {
      await ctx.runMutation(internal.noteChunks.deleteByFile, { filePath });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (action === "upload" && chunks) {
      await ctx.runMutation(internal.noteChunks.insertBatch, { chunks });
      return new Response(
        JSON.stringify({ ok: true, count: chunks.length }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("Bad request", { status: 400 });
  }),
});

// Get file hashes for incremental sync
http.route({
  path: "/api/vault/hashes",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("Authorization");
    const expectedKey = process.env.VAULT_INDEXER_API_KEY;

    if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const hashes = await ctx.runQuery(internal.noteChunks.allFilePaths);
    return new Response(JSON.stringify(hashes), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Manual trigger: poll feeds now
http.route({
  path: "/api/feeds/poll",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    await ctx.scheduler.runAfter(0, internal.actions.pollFeeds.pollAllFeeds, {});
    return new Response(JSON.stringify({ ok: true, message: "Polling scheduled" }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
