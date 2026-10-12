import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { type ActionCtx, httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import {
  type ChatMessage,
  completeJson,
  sourcesFooter,
  streamChat,
} from "./lib/companionStream";
import { DEFAULT_USER_ID } from "./lib/constants";
import {
  buildLibraryContext,
  LIBRARY_SYSTEM,
  libraryRequestSchema,
  retrieveLibraryContext,
} from "./lib/library";
import {
  LIBRARY_SEARCH_JSON_SCHEMA,
  LIBRARY_SEARCH_SYSTEM,
  librarySearchRequestSchema,
  parseLibrarySearch,
} from "./lib/librarySearch";
import { NO_EMBEDDINGS_MESSAGE, NO_PROVIDER_MESSAGE } from "./lib/providers";
import { readingCheckpointSchema } from "./lib/readingActivity";
import {
  buildCompanionPrompt,
  companionRequestSchema,
} from "./lib/readingCompanion";
import { loadReaderAI, type ProviderTarget } from "./lib/router";
import { vaultUploadSchema } from "./lib/vaultUpload";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

/** The signed-in reader's library ID, or null when the request isn't signed in. */
async function signedInReader(ctx: ActionCtx): Promise<string | null> {
  try {
    return await ctx.runQuery(internal.access.assertReader, {});
  } catch {
    return null;
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":
    process.env.SITE_URL ?? "https://reader.bhekani.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "X-Companion-Model",
};

/**
 * A reader without the keys a feature needs gets a stable code, checked
 * before any provider is called.
 */
function setupNeeded(code: "no_provider" | "no_embeddings") {
  return new Response(
    JSON.stringify({
      code,
      error:
        code === "no_provider" ? NO_PROVIDER_MESSAGE : NO_EMBEDDINGS_MESSAGE,
    }),
    {
      status: 409,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

http.route({
  path: "/api/engagement",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  ),
});
http.route({
  path: "/api/engagement",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const readerId = await signedInReader(ctx);
    if (!readerId)
      return new Response("Sign in to your reader", {
        status: 401,
        headers: CORS_HEADERS,
      });
    if (Number(request.headers.get("content-length")) > 32_000)
      return new Response("Checkpoint too large", {
        status: 413,
        headers: CORS_HEADERS,
      });
    const parsed = readingCheckpointSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return new Response("Invalid checkpoint", {
        status: 400,
        headers: CORS_HEADERS,
      });
    try {
      await ctx.runMutation(internal.readingActivity.record, {
        ...parsed.data,
        userId: readerId,
      });
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    } catch {
      return new Response("Couldn't save reading activity", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
  }),
});

/**
 * Streams a chat completion as plain text, trying each model in turn. It waits
 * for the first token so a failing model can fall back before the response
 * (and its X-Companion-Model header) is committed.
 */
async function streamWithFallback(
  chat: ChatMessage[],
  targets: ProviderTarget[],
  web: boolean,
  signal: AbortSignal,
): Promise<Response> {
  for (const target of targets) {
    const modelId = target.id;
    const events = streamChat({
      target,
      messages: chat,
      web,
      maxTokens: 1200,
      signal,
    });
    const citations: { url: string; title?: string }[] = [];
    let first: string | null = null;
    let failed: unknown = null;
    try {
      while (first === null && failed === null) {
        const next = await events.next();
        if (next.done) break;
        if (next.value.type === "text") first = next.value.text;
        else if (next.value.type === "citation") citations.push(next.value);
        else failed = next.value.error;
      }
    } catch (error) {
      failed = error;
    }
    if (failed !== null || first === null) {
      console.error(`Streamed answer: ${modelId} failed`, failed);
      await events.return(undefined);
      continue;
    }

    const encoder = new TextEncoder();
    let answer = first;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(answer));
        try {
          for (;;) {
            const next = await events.next();
            if (next.done) break;
            if (next.value.type === "text") {
              answer += next.value.text;
              controller.enqueue(encoder.encode(next.value.text));
            } else if (next.value.type === "citation") {
              citations.push(next.value);
            } else {
              console.error(
                `Streamed answer: ${modelId} failed mid-answer`,
                next.value.error,
              );
              throw new Error("The answer was interrupted. Try again.");
            }
          }
          const footer = sourcesFooter(answer, citations);
          if (footer) controller.enqueue(encoder.encode(footer));
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          await events.return(undefined);
        }
      },
      async cancel() {
        await events.return(undefined);
      },
    });
    return new Response(body, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
        "X-Companion-Model": modelId,
      },
    });
  }

  return new Response("Every model failed. Try again shortly.", {
    status: 502,
    headers: CORS_HEADERS,
  });
}

// Reading companion — streams Explain / Simplify / Ask answers for a highlighted passage
http.route({
  path: "/api/companion",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }),
});

http.route({
  path: "/api/companion",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const readerId = await signedInReader(ctx);
    if (!readerId)
      return new Response("Sign in to your reader", {
        status: 401,
        headers: CORS_HEADERS,
      });
    const parsed = companionRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return new Response("Bad request", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const targets = (await loadReaderAI(ctx, readerId)).chain(
      parsed.data.depth,
    );
    if (!targets.length) return setupNeeded("no_provider");
    const { system, messages } = buildCompanionPrompt(parsed.data);
    const chat: ChatMessage[] = [
      { role: "system", content: system },
      ...messages,
    ];

    return streamWithFallback(chat, targets, parsed.data.web, request.signal);
  }),
});

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

    const parsed = vaultUploadSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return new Response("Bad request", { status: 400 });
    const body = parsed.data;
    // The indexer key belongs to the owner, so the vault is the owner's library
    const userId = DEFAULT_USER_ID;

    if (body.action === "delete") {
      await ctx.runMutation(internal.noteChunks.deleteByFile, {
        userId,
        filePath: body.filePath,
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (body.action === "replace") {
      await ctx.runMutation(internal.noteChunks.replaceFile, {
        userId,
        filePath: body.filePath,
        chunks: body.chunks,
      });
    } else {
      await ctx.runMutation(internal.noteChunks.insertBatch, {
        userId,
        chunks: body.chunks,
      });
    }
    return new Response(
      JSON.stringify({ ok: true, count: body.chunks.length }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
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

    // The indexer key belongs to the owner, so the vault is the owner's library
    const hashes = await ctx.runQuery(internal.noteChunks.allFilePaths, {
      userId: DEFAULT_USER_ID,
    });
    return new Response(JSON.stringify(hashes), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Manual trigger: poll feeds now
http.route({
  path: "/api/feeds/poll",
  method: "POST",
  handler: httpAction(async (ctx) => {
    const readerId = await signedInReader(ctx);
    if (!readerId)
      return new Response("Sign in to your reader", { status: 401 });
    await ctx.scheduler.runAfter(0, internal.actions.pollFeeds.pollAllFeeds, {
      userId: readerId,
    });
    return new Response(
      JSON.stringify({ ok: true, message: "Polling scheduled" }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }),
});

// Ask your library — streams answers about everything the reader has saved or read
http.route({
  path: "/api/library",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }),
});

http.route({
  path: "/api/library",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const readerId = await signedInReader(ctx);
    if (!readerId)
      return new Response("Sign in to your reader", {
        status: 401,
        headers: CORS_HEADERS,
      });
    const parsed = libraryRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return new Response("Bad request", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    const ai = await loadReaderAI(ctx, readerId);
    const targets = ai.chain("quick");
    if (!targets.length) return setupNeeded("no_provider");
    const embedder = ai.embedder();
    if (!embedder) return setupNeeded("no_embeddings");
    const context = await buildLibraryContext(
      ctx,
      readerId,
      parsed.data.question,
      embedder,
    );
    const chat: ChatMessage[] = [
      { role: "system", content: LIBRARY_SYSTEM },
      {
        role: "user",
        content: `${context}\n\nQuestion: ${parsed.data.question}`,
      },
    ];
    // Follow-ups: earlier turns come after the library, newest question last
    if (parsed.data.history.length) {
      chat.splice(
        1,
        1,
        { role: "user", content: context },
        ...parsed.data.history,
        {
          role: "user",
          content: parsed.data.question,
        },
      );
    }
    return streamWithFallback(chat, targets, false, request.signal);
  }),
});

http.route({
  path: "/api/library/search",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  ),
});

http.route({
  path: "/api/library/search",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const readerId = await signedInReader(ctx);
    if (!readerId)
      return new Response("Sign in to your reader", {
        status: 401,
        headers: CORS_HEADERS,
      });
    const headers = {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    const parsed = librarySearchRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return new Response(
        JSON.stringify({
          error: "Enter a search between 2 and 2000 characters.",
        }),
        { status: 400, headers },
      );
    const ai = await loadReaderAI(ctx, readerId);
    const targets = ai.chain("quick");
    if (!targets.length) return setupNeeded("no_provider");
    const embedder = ai.embedder();
    if (!embedder) return setupNeeded("no_embeddings");
    try {
      const { context, articles } = await retrieveLibraryContext(
        ctx,
        readerId,
        parsed.data.question,
        embedder,
      );
      if (!articles.length)
        return new Response(JSON.stringify({ matches: [] }), { headers });
      for (const target of targets) {
        if (request.signal.aborted) break;
        try {
          const { content, truncated } = await completeJson({
            target,
            messages: [
              { role: "system", content: LIBRARY_SEARCH_SYSTEM },
              {
                role: "user",
                content: `${context}\n\nSearch: ${parsed.data.question}`,
              },
            ],
            maxTokens: 3000,
            jsonSchema: LIBRARY_SEARCH_JSON_SCHEMA,
            signal: request.signal,
          });
          if (truncated)
            throw new Error("Search result exceeded its token limit");
          const matches = parseLibrarySearch(content, articles);
          return new Response(JSON.stringify({ matches }), { headers });
        } catch (error) {
          if (request.signal.aborted) break;
          console.error(`Library search: ${target.id} failed`, error);
        }
      }
    } catch (error) {
      console.error("Library search retrieval failed", error);
    }
    return new Response(
      JSON.stringify({ error: "Couldn't search your library. Try again." }),
      { status: 502, headers },
    );
  }),
});

export default http;
