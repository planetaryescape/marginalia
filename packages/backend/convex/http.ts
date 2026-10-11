import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  type ChatMessage,
  sourcesFooter,
  streamChat,
} from "./lib/companionStream";
import {
  buildLibraryContext,
  LIBRARY_SYSTEM,
  libraryRequestSchema,
} from "./lib/library";
import { modelChain } from "./lib/openrouter";
import {
  buildCompanionPrompt,
  companionRequestSchema,
} from "./lib/readingCompanion";

const http = httpRouter();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Companion-Model",
};

/**
 * Streams a chat completion as plain text, trying each model in turn. It waits
 * for the first token so a failing model can fall back before the response
 * (and its X-Companion-Model header) is committed.
 */
async function streamWithFallback(
  chat: ChatMessage[],
  models: string[],
  web: boolean,
  signal: AbortSignal,
): Promise<Response> {
  for (const modelId of models) {
    const events = streamChat({
      model: modelId,
      messages: chat,
      web,
      maxTokens: 1200,
      signal,
    });
    const citations: { url: string; title?: string }[] = [];
    let first: string | null = null;
    let failed: unknown = null;
    while (first === null && failed === null) {
      const next = await events.next();
      if (next.done) break;
      if (next.value.type === "text") first = next.value.text;
      else if (next.value.type === "citation") citations.push(next.value);
      else failed = next.value.error;
    }
    if (failed !== null || first === null) {
      console.error(`Streamed answer: ${modelId} failed`, failed);
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
              break;
            }
          }
          const footer = sourcesFooter(answer, citations);
          if (footer) controller.enqueue(encoder.encode(footer));
        } finally {
          controller.close();
        }
      },
      cancel() {
        events.return(undefined);
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
    if (!process.env.OPENROUTER_API_KEY) {
      return new Response("OPENROUTER_API_KEY not configured", {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    const parsed = companionRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return new Response("Bad request", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const models = await ctx.runQuery(
      internal.userSettings.getModelsInternal,
      {},
    );
    const { system, messages } = buildCompanionPrompt(parsed.data);
    const chat: ChatMessage[] = [
      { role: "system", content: system },
      ...messages,
    ];

    return streamWithFallback(
      chat,
      modelChain(models[parsed.data.depth], parsed.data.depth),
      parsed.data.web,
      request.signal,
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
      return new Response(JSON.stringify({ ok: true, count: chunks.length }), {
        headers: { "Content-Type": "application/json" },
      });
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
    await ctx.scheduler.runAfter(
      0,
      internal.actions.pollFeeds.pollAllFeeds,
      {},
    );
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
    const parsed = libraryRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return new Response("Bad request", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    const [context, models] = await Promise.all([
      buildLibraryContext(ctx, parsed.data.question),
      ctx.runQuery(internal.userSettings.getModelsInternal, {}),
    ]);
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
      modelChain(models.quick, "quick"),
      false,
      request.signal,
    );
  }),
});

export default http;
