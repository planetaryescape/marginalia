import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { type ActionCtx, httpAction } from "./_generated/server";
import type { IngestExternalResult } from "./actions/ingestExternal";
import { type ResolvedToken, TOKEN_PREFIX } from "./apiTokens";
import { authComponent, createAuth } from "./auth";
import { streamWithFallback } from "./lib/answerStream";
import {
  retrieveArticleContext,
  retrievePassageContext,
} from "./lib/articleAsk";
import { retrievalQuery, retrieveBookContext } from "./lib/bookAsk";
import { isTerminalChatGPTError } from "./lib/chatgptResponses";
import { type ChatMessage, completeJson } from "./lib/companionStream";
import { DEFAULT_USER_ID } from "./lib/constants";
import { readerOrigins, readerPreflight, withReaderCors } from "./lib/cors";
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
import {
  MAX_PREPARED_BYTES,
  prepareRequestSchema,
} from "./lib/preparedRepresentation";
import { NO_EMBEDDINGS_MESSAGE, NO_PROVIDER_MESSAGE } from "./lib/providers";
import { readingCheckpointSchema } from "./lib/readingActivity";
import {
  buildCompanionPrompt,
  companionRequestSchema,
  selectContext,
} from "./lib/readingCompanion";
import {
  cancellablePreparation,
  interruptible,
  ownedPreparation,
  type PreparationOwner,
} from "./lib/requestControl";
import { loadReaderAI } from "./lib/router";
import { startTimings, type Timings } from "./lib/serverTiming";
import { sha256Hex, siteUrl } from "./lib/tokens";
import { vaultUploadSchema } from "./lib/vaultUpload";
import { READER_LIMITS } from "./limits";
import { hashesResponse } from "./vaultFiles";

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

/** The signed-in reader's library ID, or null when the request isn't signed in. */
async function signedInReader(
  ctx: ActionCtx,
  timings?: Timings,
): Promise<string | null> {
  try {
    return await ctx.runQuery(internal.access.assertReader, {});
  } catch {
    return null;
  } finally {
    timings?.mark("auth");
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
  timings?: Timings,
): Promise<Response | null> {
  const allowed: boolean = await ctx.runMutation(internal.limits.spend, {
    userId: readerId,
    bucket: "ai",
  });
  timings?.mark("budget");
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

/** Distinguish live-auth rejection from a provider's own terminal 401. */
function readerAuthNeeded() {
  return new Response("Sign in to your reader", {
    status: 401,
    headers: { ...CORS_HEADERS, "X-Reader-Prework-Rejection": "auth" },
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
 * Output budget for a librarian answer. The answer is short, but a reasoning
 * model spends the same budget thinking and the reply links 40 long ids.
 */
const LIBRARY_MAX_TOKENS = 4000;

class ReaderBodyTooLargeError extends Error {}

/** Direct JWT calls retain the legacy proxy's character limit. */
async function readerJson(
  request: Request,
  maxChars = 300_000,
): Promise<unknown> {
  const body = await interruptible(request.text(), request.signal);
  if (body.length > maxChars) throw new ReaderBodyTooLargeError();
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Timings begin at handler entry, including live auth and request budgeting. */
function readerAIAction(
  handler: (
    ctx: ActionCtx,
    request: Request,
    timings: Timings,
    publication: PreparationOwner,
  ) => Promise<Response>,
  { joinPreparation = false }: { joinPreparation?: boolean } = {},
) {
  return httpAction(async (ctx, request) => {
    const timings = startTimings();
    const origin = request.headers.get("Origin");
    if (origin && !readerOrigins().includes(origin))
      return withReaderCors(
        request,
        new Response("Invalid origin", { status: 403 }),
      );
    let response: Response;
    const publication = ownedPreparation(ctx, request.signal);
    try {
      request.signal.throwIfAborted();
      const work = handler(ctx, request, timings, publication);
      // Library preparation owns a durable cache publication. Its finally
      // must finish before the HTTP action exits, even though the browser has
      // already abandoned the response on Stop.
      response = joinPreparation
        ? await work
        : await interruptible(work, request.signal);
      if (joinPreparation && request.signal.aborted) {
        await response.body?.cancel();
        request.signal.throwIfAborted();
      }
    } catch (error) {
      response = new Response(
        error instanceof ReaderBodyTooLargeError
          ? "Request too large"
          : request.signal.aborted
            ? "Request cancelled"
            : "Couldn't prepare your answer. Try again.",
        {
          status:
            error instanceof ReaderBodyTooLargeError
              ? 413
              : request.signal.aborted
                ? 499
                : 502,
        },
      );
    } finally {
      // Only the successfully returned stream may inherit the private lifetime.
      // On Stop the outer waiter may leave shared refresh alone, but must drain
      // every registered private transaction/helper before its context exits.
      if (request.signal.aborted || !publication.response) {
        publication.abort();
        try {
          await publication.response?.body?.cancel();
        } catch {
          // An already-errored stream still owes its private transactions.
        } finally {
          await publication.settle();
          publication.dispose();
        }
      }
    }
    const headers = new Headers(response.headers);
    headers.set("Server-Timing", timings.header());
    headers.set("Cache-Control", "no-store");
    return withReaderCors(
      request,
      new Response(response.body, { status: response.status, headers }),
    );
  });
}

function preparedMiss() {
  return Response.json(
    {
      code: "prepared_reference_miss",
      error:
        "The displayed text needs preparing again. If it changed, reopen the article.",
    },
    { status: 409 },
  );
}

http.route({
  path: "/api/companion/prepare",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => readerPreflight(request)),
});
http.route({
  path: "/api/companion/prepare",
  method: "POST",
  handler: readerAIAction(
    async (ctx, request, timings) => {
      const readerId = await signedInReader(ctx, timings);
      if (!readerId) return readerAuthNeeded();
      const parsed = prepareRequestSchema.safeParse(
        await readerJson(request, 1_000_000),
      );
      timings.mark("parse");
      if (!parsed.success) return new Response("Bad request", { status: 400 });
      if (
        new TextEncoder().encode(JSON.stringify(parsed.data.paragraphs))
          .byteLength > MAX_PREPARED_BYTES
      )
        return new Response("Displayed text too large to prepare", {
          status: 413,
        });
      const prepared = await cancellablePreparation(
        ctx,
        request.signal,
      ).runMutation(internal.preparedArticles.prepare, {
        ...parsed.data,
        userId: readerId,
      });
      return prepared ? Response.json({ prepared }) : preparedMiss();
    },
    { joinPreparation: true },
  ),
});

// Reading companion — streams Explain / Simplify / Ask answers for a highlighted passage
http.route({
  path: "/api/companion",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => readerPreflight(request)),
});

http.route({
  path: "/api/companion",
  method: "POST",
  handler: readerAIAction(async (ctx, request, timings, publication) => {
    const readerId = await signedInReader(publication.ctx, timings);
    request.signal.throwIfAborted();
    if (!readerId) return readerAuthNeeded();
    const limited = await aiBudgetExceeded(publication.ctx, readerId, timings);
    if (limited) return limited;
    const parsed = companionRequestSchema.safeParse(await readerJson(request));
    timings.mark("parse");
    if (!parsed.success) {
      return new Response("Bad request", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const preparation = publication.ctx;
    if (parsed.data.prepared && parsed.data.articleId) {
      const paragraphs = await preparation.runQuery(
        internal.preparedArticles.read,
        {
          userId: readerId,
          articleId: parsed.data.articleId,
          unitIndex: parsed.data.unitIndex,
          reference: parsed.data.prepared,
        },
      );
      // This outcome is exclusively pre-provider. A client may prepare and retry once.
      if (!paragraphs) return preparedMiss();
      parsed.data.paragraphs = paragraphs;
    }
    if (
      parsed.data.articleId &&
      !(await preparation.runQuery(internal.articlePassages.authorized, {
        userId: readerId,
        articleId: parsed.data.articleId,
      }))
    )
      return new Response("Article not found", { status: 404 });
    if (parsed.data.articleId) {
      const summaryDefinition =
        parsed.data.mode === "define" && parsed.data.paragraphIndex === null
          ? await preparation.runQuery(internal.summaries.definitionContext, {
              userId: readerId,
              articleId: parsed.data.articleId,
              selection: parsed.data.selection,
            })
          : null;
      if (summaryDefinition) {
        parsed.data.paragraphs = [summaryDefinition.sentence];
        parsed.data.paragraphIndex = 0;
        parsed.data.paragraphIndices = undefined;
        parsed.data.paragraphEnd = undefined;
        parsed.data.sentence = summaryDefinition.sentence;
        parsed.data.occurrence = 0;
        parsed.data.contextOccurrence = 0;
        parsed.data.prepared = undefined;
        parsed.data.title = `${parsed.data.title} — generated summary`;
      }
      const study = await preparation.runQuery(internal.bible.studySource, {
        userId: readerId,
        articleId: parsed.data.articleId,
      });
      if (study && !summaryDefinition) {
        // A display edition is not an AI source, including selection/Define paths.
        const mode = parsed.data.mode;
        parsed.data.mode = "article";
        parsed.data.paragraphs = study.content.split(/\n\n+/).filter(Boolean);
        parsed.data.selection = "";
        parsed.data.paragraphIndex = null;
        parsed.data.paragraphIndices = undefined;
        parsed.data.paragraphEnd = undefined;
        parsed.data.sentence = undefined;
        parsed.data.prepared = undefined;
        parsed.data.title = `${study.title} — World English Bible study source`;
        parsed.data.question ??= `${mode === "article" ? "Explain" : mode} this passage using the supplied World English Bible text, not the wording of another displayed edition.`;
      }
    }
    const [summary, { ai, book, article, nearby }] = await Promise.all([
      parsed.data.articleId
        ? preparation.runQuery(internal.summaries.forCompanion, {
            articleId: parsed.data.articleId,
            userId: readerId,
          })
        : null,
      publication.run(async () => {
        // Keep the raw context captured by shared rotating-credential factories.
        const ai = await loadReaderAI(ctx, readerId, {
          roles: [parsed.data.depth],
          signal: publication.signal,
        });
        request.signal.throwIfAborted();
        timings.mark("ai");
        if (!ai.chain(parsed.data.depth).length)
          return { ai, book: null, article: null, nearby: null };
        // A question about a whole book carries its outline and the passages that
        // match it, not the book (D-DES-054)
        const book =
          parsed.data.mode === "article" &&
          parsed.data.articleId &&
          parsed.data.unitIndex !== undefined
            ? await retrieveBookContext(preparation, {
                userId: readerId,
                articleId: parsed.data.articleId,
                unitIndex: parsed.data.unitIndex,
                question: retrievalQuery(
                  parsed.data.question ?? "",
                  parsed.data.history,
                ),
                embedder: ai.embedder(),
              })
            : null;
        request.signal.throwIfAborted();
        // So is a question about a long article (the summary is sent either way)
        const article =
          parsed.data.mode === "article" && !book
            ? await retrieveArticleContext(preparation, {
                userId: readerId,
                articleId: parsed.data.articleId,
                paragraphs: parsed.data.paragraphs,
                paragraphIndex: parsed.data.paragraphIndex,
                question: parsed.data.question ?? "",
                history: parsed.data.history,
                embedder: ai.embedder(),
                publication,
              })
            : null;
        request.signal.throwIfAborted();
        // Ask about a passage can reach beyond its window into the same article.
        // A book's parts are searched by their own path, so only an article here.
        const nearby =
          parsed.data.mode === "ask" && parsed.data.unitIndex === undefined
            ? await retrievePassageContext(preparation, {
                userId: readerId,
                articleId: parsed.data.articleId,
                paragraphs: parsed.data.paragraphs,
                window: selectContext(parsed.data).indices,
                question: parsed.data.question ?? "",
                history: parsed.data.history,
                embedder: ai.embedder(),
                publication,
              })
            : null;
        request.signal.throwIfAborted();
        return { ai, book, article, nearby };
      }),
    ]);
    const targets = ai.chain(parsed.data.depth);
    if (!targets.length) return setupNeeded("no_provider");
    timings.mark("retrieve");
    if (article)
      console.log(
        `ask article context: ${article.mode}, ${article.charsBefore} chars before, ${article.charsAfter} after`,
      );
    if (nearby)
      console.log(
        `ask passage context: ${nearby.searched ? "searched" : "not searched"}, ${nearby.related?.chars ?? 0} chars from elsewhere`,
      );
    const { system, messages } = buildCompanionPrompt(
      parsed.data,
      summary,
      book,
      article?.selection,
      nearby?.related,
    );
    const chat: ChatMessage[] = [
      { role: "system", content: system },
      ...messages,
    ];

    const response = await streamWithFallback(
      chat,
      targets,
      parsed.data.web,
      request.signal,
      (error) => publication.run(() => ai.noteFailure(error)),
      1200,
      { depth: parsed.data.depth, timings, publication },
    );
    if (response.status === 200) return publication.handoff(response);
    return response;
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
    return hashesResponse(ctx, request, DEFAULT_USER_ID);
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
  handler: httpAction(async (_ctx, request) => readerPreflight(request)),
});

http.route({
  path: "/api/library",
  method: "POST",
  handler: readerAIAction(
    async (ctx, request, timings) => {
      const readerId = await signedInReader(ctx, timings);
      request.signal.throwIfAborted();
      if (!readerId) return readerAuthNeeded();
      const limited = await aiBudgetExceeded(ctx, readerId, timings);
      if (limited) return limited;
      const parsed = libraryRequestSchema.safeParse(await readerJson(request));
      timings.mark("parse");
      if (!parsed.success) {
        return new Response("Bad request", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }
      const ai = await loadReaderAI(ctx, readerId, {
        roles: ["quick"],
        signal: request.signal,
      });
      request.signal.throwIfAborted();
      timings.mark("ai");
      const targets = ai.chain("quick");
      if (!targets.length) return setupNeeded("no_provider");
      const embedder = ai.embedder();
      if (!embedder) return setupNeeded("no_embeddings");
      const context = await buildLibraryContext(
        cancellablePreparation(ctx, request.signal),
        readerId,
        parsed.data.question,
        embedder,
        parsed.data.history,
        timings,
      );
      request.signal.throwIfAborted();
      timings.mark("retrieve");
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
        LIBRARY_MAX_TOKENS,
        { timings },
      );
    },
    { joinPreparation: true },
  ),
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
  handler: readerAIAction(findLibrary, { joinPreparation: true }),
});

async function findLibrary(ctx: ActionCtx, request: Request, timings: Timings) {
  const readerId = await signedInReader(ctx, timings);
  request.signal.throwIfAborted();
  if (!readerId) return readerAuthNeeded();
  const limited = await aiBudgetExceeded(ctx, readerId, timings);
  if (limited) return limited;
  const headers = {
    ...CORS_HEADERS,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const parsed = librarySearchRequestSchema.safeParse(
    await readerJson(request),
  );
  timings.mark("parse");
  if (!parsed.success)
    return new Response(
      JSON.stringify({
        error: "Enter a search between 2 and 2000 characters.",
      }),
      { status: 400, headers },
    );
  const ai = await loadReaderAI(ctx, readerId, {
    text: false,
    signal: request.signal,
  });
  timings.mark("ai");
  const embedder = ai.embedder();
  if (!embedder) return setupNeeded("no_embeddings");
  try {
    const found = await findLibraryArticles(
      cancellablePreparation(ctx, request.signal),
      readerId,
      parsed.data.question,
      embedder,
      timings,
    );
    return new Response(JSON.stringify(found), {
      headers: { ...headers, "Server-Timing": timings.header() },
    });
  } catch (error) {
    console.error("Library find failed");
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
  handler: readerAIAction(searchLibrary, { joinPreparation: true }),
});

async function searchLibrary(
  ctx: ActionCtx,
  request: Request,
  timings: Timings,
) {
  const readerId = await signedInReader(ctx, timings);
  request.signal.throwIfAborted();
  if (!readerId) return readerAuthNeeded();
  const limited = await aiBudgetExceeded(ctx, readerId, timings);
  if (limited) return limited;
  const headers = {
    ...CORS_HEADERS,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const parsed = librarySearchRequestSchema.safeParse(
    await readerJson(request),
  );
  timings.mark("parse");
  if (!parsed.success)
    return new Response(
      JSON.stringify({
        error: "Enter a search between 2 and 2000 characters.",
      }),
      { status: 400, headers },
    );
  const ai = await loadReaderAI(ctx, readerId, {
    roles: ["quick"],
    signal: request.signal,
  });
  timings.mark("ai");
  const targets = ai.chain("quick");
  if (!targets.length) return setupNeeded("no_provider");
  const embedder = ai.embedder();
  if (!embedder) return setupNeeded("no_embeddings");
  try {
    const { context, articles } = await retrieveLibraryContext(
      cancellablePreparation(ctx, request.signal),
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
        console.error(`Library search: ${target.id} failed`);
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
  } catch {
    console.error("Library search retrieval failed");
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
