import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { type ActionCtx, httpAction } from "./_generated/server";
import type { IngestExternalResult } from "./actions/ingestExternal";
import { type ResolvedToken, TOKEN_PREFIX } from "./apiTokens";
import { authComponent, createAuth } from "./auth";
import { isTerminalChatGPTError } from "./lib/chatgptResponses";
import {
  type ChatMessage,
  completeJson,
  sourcesFooter,
  streamChat,
} from "./lib/companionStream";
import { DEFAULT_USER_ID } from "./lib/constants";
import { readerPreflight, withReaderCors } from "./lib/cors";
import {
  bearerToken,
  externalArticleSchema,
  highlightsPathArticleId,
  MAX_ARTICLE_REQUEST_BYTES,
} from "./lib/externalApi";
import {
  buildLibraryContext,
  findLibraryArticles,
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
import { startTimings } from "./lib/serverTiming";
import { sha256Hex, siteUrl } from "./lib/tokens";
import { vaultUploadSchema } from "./lib/vaultUpload";
import { READER_LIMITS } from "./limits";

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
  "Access-Control-Expose-Headers": "X-Companion-Model, Server-Timing",
};

/** Null while the reader is within their AI request budget; a 429 otherwise. */
async function aiBudgetExceeded(
  ctx: ActionCtx,
  readerId: string,
): Promise<Response | null> {
  const allowed: boolean = await ctx.runMutation(internal.limits.spend, {
    userId: readerId,
    bucket: "ai",
  });
  if (allowed) return null;
  return new Response(
    JSON.stringify({ code: "rate_limited", error: READER_LIMITS.ai.message }),
    {
      status: 429,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Retry-After": "60",
      },
    },
  );
}

function jsonError(status: number, body: { code: string; error: string }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

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
  onFailure: (error: unknown) => Promise<void>,
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
      await onFailure(failed).catch(() => {});
      // A ChatGPT plan's limit or eligibility is shown to the reader rather
      // than quietly moving the answer to one of their paid API keys
      if (isTerminalChatGPTError(failed))
        return jsonError(failed.responseStatus, {
          code: `chatgpt_${failed.kind}`,
          error: failed.readerMessage,
        });
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
    const limited = await aiBudgetExceeded(ctx, readerId);
    if (limited) return limited;
    const parsed = companionRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return new Response("Bad request", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const ai = await loadReaderAI(ctx, readerId);
    const targets = ai.chain(parsed.data.depth);
    if (!targets.length) return setupNeeded("no_provider");
    const summary = parsed.data.articleId
      ? await ctx.runQuery(internal.summaries.forCompanion, {
          articleId: parsed.data.articleId,
          userId: readerId,
        })
      : null;
    const { system, messages } = buildCompanionPrompt(parsed.data, summary);
    const chat: ChatMessage[] = [
      { role: "system", content: system },
      ...messages,
    ];

    return streamWithFallback(
      chat,
      targets,
      parsed.data.web,
      request.signal,
      ai.noteFailure,
    );
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
    const limited = await aiBudgetExceeded(ctx, readerId);
    if (limited) return limited;
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
    return streamWithFallback(
      chat,
      targets,
      false,
      request.signal,
      ai.noteFailure,
    );
  }),
});

http.route({
  path: "/api/library/find",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => readerPreflight(request)),
});

// The search-only path behind the topic picker's first card: embedding and
// vector search, no model call. /api/library/search adds the explanations.
http.route({
  path: "/api/library/find",
  method: "POST",
  // Browsers call this directly with the Convex JWT as a Bearer token, so
  // the CORS headers depend on the request's origin.
  handler: httpAction(async (ctx, request) =>
    withReaderCors(request, await findLibrary(ctx, request)),
  ),
});

async function findLibrary(ctx: ActionCtx, request: Request) {
  const readerId = await signedInReader(ctx);
  if (!readerId)
    return new Response("Sign in to your reader", {
      status: 401,
      headers: CORS_HEADERS,
    });
  const limited = await aiBudgetExceeded(ctx, readerId);
  if (limited) return limited;
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
  const timings = startTimings();
  const ai = await loadReaderAI(ctx, readerId);
  timings.mark("ai");
  const embedder = ai.embedder();
  if (!embedder) return setupNeeded("no_embeddings");
  try {
    const found = await findLibraryArticles(
      ctx,
      readerId,
      parsed.data.question,
      embedder,
      timings,
    );
    return new Response(JSON.stringify(found), {
      headers: { ...headers, "Server-Timing": timings.header() },
    });
  } catch (error) {
    console.error("Library find failed", error);
    await ai.noteFailure(error).catch(() => {});
    return new Response(
      JSON.stringify({ error: "Couldn't search your library. Try again." }),
      { status: 502, headers },
    );
  }
}

http.route({
  path: "/api/library/search",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => readerPreflight(request)),
});

http.route({
  path: "/api/library/search",
  method: "POST",
  // Browsers call this directly with the Convex JWT as a Bearer token, so
  // the CORS headers depend on the request's origin.
  handler: httpAction(async (ctx, request) =>
    withReaderCors(request, await searchLibrary(ctx, request)),
  ),
});

async function searchLibrary(ctx: ActionCtx, request: Request) {
  const readerId = await signedInReader(ctx);
  if (!readerId)
    return new Response("Sign in to your reader", {
      status: 401,
      headers: CORS_HEADERS,
    });
  const limited = await aiBudgetExceeded(ctx, readerId);
  if (limited) return limited;
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
  const timings = startTimings();
  const ai = await loadReaderAI(ctx, readerId);
  timings.mark("ai");
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
      timings,
    );
    timings.mark("retrieve");
    if (!articles.length)
      return new Response(JSON.stringify({ matches: [] }), {
        headers: { ...headers, "Server-Timing": timings.header() },
      });
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
        timings.mark("rank");
        const matches = parseLibrarySearch(content, articles);
        return new Response(JSON.stringify({ matches }), {
          headers: { ...headers, "Server-Timing": timings.header() },
        });
      } catch (error) {
        if (request.signal.aborted) break;
        console.error(`Library search: ${target.id} failed`, error);
        await ai.noteFailure(error).catch(() => {});
        if (isTerminalChatGPTError(error))
          return new Response(
            JSON.stringify({
              code: `chatgpt_${error.kind}`,
              error: error.readerMessage,
            }),
            { status: error.responseStatus, headers },
          );
      }
    }
  } catch (error) {
    console.error("Library search retrieval failed", error);
  }
  return new Response(
    JSON.stringify({ error: "Couldn't search your library. Try again." }),
    { status: 502, headers },
  );
}

// Public API for other apps, authenticated with a reader's personal API token.
// Server-to-server only, so it sends no CORS headers.

function apiJson(status: number, body: unknown, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

/** The token's library ID, or the error response to send instead. */
async function apiCaller(
  ctx: ActionCtx,
  request: Request,
): Promise<{ userId: string } | { response: Response }> {
  const token = bearerToken(request.headers.get("Authorization"));
  if (!token?.startsWith(TOKEN_PREFIX))
    return {
      response: apiJson(401, {
        code: "unauthorized",
        error: "Send a personal API token as a Bearer token.",
      }),
    };
  const resolved: ResolvedToken = await ctx.runMutation(
    internal.apiTokens.resolve,
    { hash: await sha256Hex(token) },
  );
  if (resolved.ok) return { userId: resolved.userId };
  if (resolved.reason === "rate_limited")
    return {
      response: apiJson(
        429,
        { code: "rate_limited", error: READER_LIMITS.api.message },
        { "Retry-After": "60" },
      ),
    };
  return {
    response: apiJson(401, {
      code: "unauthorized",
      error: "This token isn't valid. Create a new one in your account.",
    }),
  };
}

http.route({
  path: "/api/v1/articles",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const caller = await apiCaller(ctx, request);
    if ("response" in caller) return caller.response;
    if (
      Number(request.headers.get("content-length")) > MAX_ARTICLE_REQUEST_BYTES
    )
      return apiJson(413, {
        code: "too_large",
        error: "This article is too large to send.",
      });
    const parsed = externalArticleSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return apiJson(400, {
        code: "invalid_request",
        error:
          "Send externalId, title and html, with optional url, author and publishedAt.",
      });
    const result: IngestExternalResult = await ctx.runAction(
      internal.actions.ingestExternal.ingest,
      { userId: caller.userId, ...parsed.data },
    );
    if (!result.ok)
      return apiJson(413, {
        code: "too_large",
        error: "This article is too large to store, even after cleaning.",
      });
    return apiJson(result.created ? 201 : 200, {
      articleId: result.articleId,
      readUrl: `${siteUrl()}/read/${result.articleId}`,
      created: result.created,
    });
  }),
});

http.route({
  pathPrefix: "/api/v1/articles/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const articleId = highlightsPathArticleId(new URL(request.url).pathname);
    if (!articleId)
      return apiJson(404, { code: "not_found", error: "Not found." });
    const caller = await apiCaller(ctx, request);
    if ("response" in caller) return caller.response;
    const found = await ctx.runQuery(
      internal.externalApi.highlightsForArticle,
      {
        userId: caller.userId,
        articleId,
      },
    );
    if (!found)
      return apiJson(404, {
        code: "not_found",
        error: "No article with this ID in your library.",
      });
    return apiJson(200, found);
  }),
});

export default http;
