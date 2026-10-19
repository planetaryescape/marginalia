/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ownerTest,
  runScheduled,
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { KEY_NOT_CONFIGURED } from "./lib/providerKeys";
import { NO_EMBEDDINGS_MESSAGE, NO_PROVIDER_MESSAGE } from "./lib/providers";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const DEPLOYMENT_KEY = "deployment-openrouter-key-fixture";
const OWNER_OPENAI = "sk-owner-openai-key-fixture-0001";
const READER_OPENAI = "sk-reader-openai-key-fixture-0002";
const READER_OPENROUTER = "sk-or-reader-openrouter-fixture-0003";
const READER_ANTHROPIC = "sk-ant-reader-anthropic-fixture-0004";
const embedding = Array.from({ length: 1536 }, () => 0.5);

beforeEach(() => {
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  // Don't let a developer's shell decide the owner-transition behaviour
  vi.stubEnv("OPENROUTER_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

interface Call {
  url: string;
  headers: Headers;
  body: any;
}

/** Records every provider request; no real provider is ever called. */
function mockProviders(
  respond: (call: Call) => Response | Promise<Response> = () =>
    Response.json({ data: [] }),
) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = {
        url: String(input),
        headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      return respond(call);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function chatStream(text: string) {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function anthropicStream(text: string) {
  const events = [
    { type: "message_start", message: { id: "m" } },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
    { type: "message_stop" },
  ];
  return new Response(
    events
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

const companionBody = JSON.stringify({
  mode: "explain",
  title: "An article",
  paragraphs: ["A passage"],
  selection: "A passage",
  paragraphIndex: 0,
});

type Client = Awaited<ReturnType<typeof ownerTest>>;
const companion = (client: Pick<Client, "fetch">) =>
  client.fetch("/api/companion", { method: "POST", body: companionBody });

async function credentialRows(t: Pick<Client, "run">) {
  return t.run((ctx) => ctx.db.query("providerCredentials").take(20));
}

describe("saving provider keys", () => {
  it("checks each key against its provider's model list and stores it sealed", async () => {
    const t = await ownerTest(modules);
    const { calls } = mockProviders();
    const keys = {
      openrouter: READER_OPENROUTER,
      openai: OWNER_OPENAI,
      anthropic: READER_ANTHROPIC,
    } as const;
    for (const [provider, key] of Object.entries(keys) as [
      keyof typeof keys,
      string,
    ][]) {
      expect(
        await t.action(api.providerCredentials.save, {
          provider,
          apiKey: `  ${key}\n`,
        }),
      ).toEqual({ provider, last4: key.slice(-4) });
    }

    expect(calls.map((c) => c.url)).toEqual([
      "https://openrouter.ai/api/v1/key",
      "https://api.openai.com/v1/models",
      "https://api.anthropic.com/v1/models",
    ]);
    expect(calls[0].headers.get("Authorization")).toBe(
      `Bearer ${READER_OPENROUTER}`,
    );
    expect(calls[1].headers.get("Authorization")).toBe(
      `Bearer ${OWNER_OPENAI}`,
    );
    expect(calls[2].headers.get("x-api-key")).toBe(READER_ANTHROPIC);
    expect(calls[2].headers.get("anthropic-version")).toBe("2023-06-01");
    expect(calls[2].headers.get("Authorization")).toBeNull();

    const rows = await credentialRows(t);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.userId).toBe(OWNER);
      expect(row.last4).toBe(keys[row.provider].slice(-4));
      for (const key of Object.values(keys))
        expect(JSON.stringify(row)).not.toContain(key);
    }

    const list = await t.query(api.providerCredentials.list, {});
    expect(list.map((row) => Object.keys(row).sort())).toEqual(
      Array(3).fill(["last4", "provider", "updatedAt", "validatedAt"]),
    );
    const visible = JSON.stringify([
      list,
      await t.query(api.providerCredentials.capabilities, {}),
      await t.query(api.userSettings.getModels, {}),
    ]);
    for (const secret of [
      ...Object.values(keys),
      ...rows.flatMap((r) => [r.ciphertext, r.iv]),
    ])
      expect(visible).not.toContain(secret);
  });

  it("rejects a refused key without storing or repeating it", async () => {
    const t = await ownerTest(modules);
    mockProviders(() => new Response("Incorrect API key", { status: 401 }));
    const attempt = t.action(api.providerCredentials.save, {
      provider: "openai",
      apiKey: READER_OPENAI,
    });
    await expect(attempt).rejects.toThrow("OpenAI didn't accept that key");
    await attempt.catch((error) =>
      expect(String(error)).not.toContain(READER_OPENAI),
    );
    expect(await credentialRows(t)).toEqual([]);
  });

  it("refuses to save when the server has no encryption key, before sending the key anywhere", async () => {
    vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", "");
    const t = await ownerTest(modules);
    const { fetchMock } = mockProviders();
    await expect(
      t.action(api.providerCredentials.save, {
        provider: "openai",
        apiKey: READER_OPENAI,
      }),
    ).rejects.toThrow(KEY_NOT_CONFIGURED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await credentialRows(t)).toEqual([]);
  });

  it("replaces a provider's key in place and removes it", async () => {
    const t = await ownerTest(modules);
    mockProviders();
    for (const apiKey of [READER_OPENAI, OWNER_OPENAI])
      await t.action(api.providerCredentials.save, {
        provider: "openai",
        apiKey,
      });
    expect(await t.query(api.providerCredentials.list, {})).toMatchObject([
      { provider: "openai", last4: OWNER_OPENAI.slice(-4) },
    ]);
    await t.mutation(api.providerCredentials.remove, { provider: "openai" });
    expect(await t.query(api.providerCredentials.list, {})).toEqual([]);
    expect(await credentialRows(t)).toEqual([]);
  });
});

describe("keys stay in their own library", () => {
  it("lets a second reader neither see, remove nor use the owner's keys", async () => {
    const { t, owner, reader } = await secondReaderTest(modules);
    mockProviders();
    await owner.action(api.providerCredentials.save, {
      provider: "openai",
      apiKey: OWNER_OPENAI,
    });
    const { fetchMock } = mockProviders();

    expect(await reader.query(api.providerCredentials.list, {})).toEqual([]);
    expect(
      await reader.query(api.providerCredentials.capabilities, {}),
    ).toMatchObject({ text: false, embeddings: false, providers: [] });
    await reader.mutation(api.providerCredentials.remove, {
      provider: "openai",
    });
    expect(await credentialRows(t)).toHaveLength(1);

    const response = await companion(reader);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "no_provider",
      error: NO_PROVIDER_MESSAGE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can't open a sealed key copied into another library", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await saveTestCredential(t, OWNER, "openai", OWNER_OPENAI);
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("providerCredentials").take(1);
      const { _id, _creationTime, ...copy } = row;
      await ctx.db.insert("providerCredentials", {
        ...copy,
        userId: readerLibraryId,
      });
    });
    const { fetchMock } = mockProviders();
    expect((await companion(reader)).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("models from the reader's own providers", () => {
  it("lists only reachable models and falls back when a key is removed", async () => {
    const t = await ownerTest(modules);
    await saveTestCredential(t, OWNER, "openrouter", READER_OPENROUTER);
    await saveTestCredential(t, OWNER, "openai", OWNER_OPENAI);
    const before = await t.query(api.userSettings.getModels, {});
    expect(before.available.map((m) => m.id)).toEqual([
      "openrouter:anthropic/claude-haiku-5.5",
      "openrouter:deepseek/deepseek-v4.1-flash",
      "openrouter:openai/gpt-6-luna",
      "openrouter:google/gemini-3.8-flash",
      "openrouter:anthropic/claude-sonnet-5.5",
      "openrouter:~openai/gpt-terra-latest",
      "openai:gpt-6-luna",
      "openai:gpt-6.1-sol",
    ]);
    await t.mutation(api.userSettings.setModel, {
      role: "quick",
      model: "openrouter:google/gemini-3.8-flash",
    });
    expect((await t.query(api.userSettings.getModels, {})).selected.quick).toBe(
      "openrouter:google/gemini-3.8-flash",
    );

    await t.mutation(api.providerCredentials.remove, {
      provider: "openrouter",
    });
    expect(await t.query(api.userSettings.getModels, {})).toEqual({
      selected: {
        annotations: "openai:gpt-6-luna",
        quick: "openai:gpt-6-luna",
        deep: "openai:gpt-6.1-sol",
      },
      available: [
        { id: "openai:gpt-6-luna", name: "GPT-6 Luna", provider: "openai" },
        { id: "openai:gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "openai" },
      ],
    });
    await expect(
      t.mutation(api.userSettings.setModel, {
        role: "quick",
        model: "openrouter:google/gemini-3.8-flash",
      }),
    ).rejects.toThrow("isn't available");
  });

  it("offers text but not search with only an Anthropic key", async () => {
    const t = await ownerTest(modules);
    await saveTestCredential(t, OWNER, "anthropic", READER_ANTHROPIC);
    expect(await t.query(api.providerCredentials.capabilities, {})).toEqual({
      text: true,
      embeddings: false,
      providers: ["anthropic"],
    });
    expect(
      (await t.query(api.userSettings.getModels, {})).selected,
    ).toMatchObject({ deep: "anthropic:claude-sonnet-5-5" });
  });

  it("reports a missing key before calling any provider", async () => {
    const t = await ownerTest(modules);
    const articleId = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: OWNER,
        guid: "a",
        url: "https://example.com/a",
        title: "A",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    const { fetchMock } = mockProviders();
    expect((await t.query(api.userSettings.getModels, {})).selected).toEqual({
      annotations: null,
      quick: null,
      deep: null,
    });
    for (const path of ["companion", "library", "library/search"]) {
      const response = await t.fetch(`/api/${path}`, {
        method: "POST",
        body:
          path === "companion"
            ? companionBody
            : JSON.stringify({ question: "What did I read?" }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "no_provider" });
    }
    await expect(
      t.action(api.actions.summarize.generate, {
        articleId,
        title: "A",
        paragraphs: ["Text"],
        sourceHash: await (
          await import("./lib/preparedRepresentation")
        ).sourceHash(),
      }),
    ).rejects.toThrow(NO_PROVIDER_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("provider router", () => {
  it("streams from OpenAI with only the reader's own key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", DEPLOYMENT_KEY);
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await saveTestCredential(t, OWNER, "openai", OWNER_OPENAI);
    await saveTestCredential(t, readerLibraryId, "openai", READER_OPENAI);
    const { calls } = mockProviders(() => chatStream("From OpenAI."));
    const response = await companion(reader);
    expect(await response.text()).toBe("From OpenAI.");
    expect(response.headers.get("X-Companion-Model")).toBe("openai:gpt-6-luna");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].headers.get("Authorization")).toBe(
      `Bearer ${READER_OPENAI}`,
    );
    expect(calls[0].body).toMatchObject({ model: "gpt-6-luna", stream: true });
  });

  it("streams from Anthropic with the reader's key in x-api-key", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await saveTestCredential(t, readerLibraryId, "anthropic", READER_ANTHROPIC);
    const { calls } = mockProviders(() => anthropicStream("From Claude."));
    const response = await companion(reader);
    expect(await response.text()).toBe("From Claude.");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers.get("x-api-key")).toBe(READER_ANTHROPIC);
    expect(calls[0].headers.get("anthropic-version")).toBe("2023-06-01");
    expect(calls[0].headers.get("Authorization")).toBeNull();
    expect(calls[0].body.model).toBe("claude-haiku-5-5");
    expect(typeof calls[0].body.system).toBe("string");
    expect(
      calls[0].body.messages.some((m: { role: string }) => m.role === "system"),
    ).toBe(false);
  });

  it("falls back only to another of the reader's own models", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", DEPLOYMENT_KEY);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await saveTestCredential(t, readerLibraryId, "openai", READER_OPENAI);
    let attempt = 0;
    const { calls } = mockProviders(() =>
      attempt++ === 0
        ? new Response("Overloaded", { status: 503 })
        : chatStream("Second model."),
    );
    const response = await companion(reader);
    expect(await response.text()).toBe("Second model.");
    expect(calls.map((c) => [c.url, c.body.model])).toEqual([
      ["https://api.openai.com/v1/chat/completions", "gpt-6-luna"],
      ["https://api.openai.com/v1/chat/completions", "gpt-6.1-sol"],
    ]);
    for (const call of calls)
      expect(call.headers.get("Authorization")).toBe(`Bearer ${READER_OPENAI}`);
  });

  it("summarises through the AI SDK with the reader's Anthropic key", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await saveTestCredential(t, readerLibraryId, "anthropic", READER_ANTHROPIC);
    const articleId: Id<"articles"> = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: readerLibraryId,
        guid: "reader-summary",
        url: "https://example.com/reader-summary",
        title: "Reader article",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    const summary = {
      gist: "Rest is useful.",
      thesis: "Rest helps people think.",
      ideas: [
        {
          id: "a",
          label: "Rest helps",
          detail: "Rest supports clear thinking.",
          role: "conclusion",
          paragraphs: [1],
        },
      ],
      links: [],
      flow: "Rest leads to clear thinking.",
    };
    const { calls } = mockProviders(({ body }) => {
      // Answer in whichever structured-output form the SDK asked for
      const tool = body.tools?.[0]?.name;
      return Response.json({
        id: "msg",
        type: "message",
        role: "assistant",
        model: body.model,
        content: tool
          ? [{ type: "tool_use", id: "tool", name: tool, input: summary }]
          : [{ type: "text", text: JSON.stringify(summary) }],
        stop_reason: tool ? "tool_use" : "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    });
    await reader.action(api.actions.summarize.generate, {
      articleId,
      title: "Reader article",
      paragraphs: ["Rest supports clear thinking."],
      sourceHash: await (
        await import("./lib/preparedRepresentation")
      ).sourceHash(),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers.get("x-api-key")).toBe(READER_ANTHROPIC);
    expect(calls[0].body.max_tokens).toBe(4096);
    expect(
      await reader.query(api.summaries.getByArticle, { articleId }),
    ).toMatchObject({
      gist: "Rest is useful.",
      model: "anthropic:claude-haiku-5-5",
    });
  });
});

describe("deployment keys", () => {
  it("never uses a deployment OpenRouter key, even for the owner", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", DEPLOYMENT_KEY);
    for (const client of [
      await ownerTest(modules),
      (await secondReaderTest(modules)).reader,
    ]) {
      const { fetchMock } = mockProviders();
      expect(
        await client.query(api.providerCredentials.capabilities, {}),
      ).toMatchObject({ text: false, providers: [] });
      const response = await companion(client);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "no_provider" });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("uses the owner's own saved key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", DEPLOYMENT_KEY);
    const t = await ownerTest(modules);
    await saveTestCredential(t, OWNER, "openai", OWNER_OPENAI);
    const { calls } = mockProviders(() => chatStream("Answer."));
    await (await companion(t)).text();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].headers.get("Authorization")).toBe(
      `Bearer ${OWNER_OPENAI}`,
    );
  });
});

describe("embeddings", () => {
  beforeEach(() => vi.useFakeTimers());

  async function readerNote(
    t: Awaited<ReturnType<typeof secondReaderTest>>["t"],
    userId: string,
  ) {
    return t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId,
        guid: "note-article",
        url: "https://example.com/note-article",
        title: "Note article",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
      return ctx.db.insert("userNotes", {
        userId,
        articleId,
        selectedText: "A passage",
        content: "<p>My note</p>",
        contentPlain: "My note",
        createdAt: 1,
        updatedAt: 1,
      });
    });
  }

  it("skips embedding without an embedding key, keeps the note, and explains search", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", DEPLOYMENT_KEY);
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    // Another library's OpenAI key must not embed this reader's note
    await saveTestCredential(t, OWNER, "openai", OWNER_OPENAI);
    await saveTestCredential(t, readerLibraryId, "anthropic", READER_ANTHROPIC);
    const noteId = await readerNote(t, readerLibraryId);
    const { fetchMock } = mockProviders();

    await t.action(internal.actions.embedUserNote.embed, { noteId });
    await runScheduled(t);
    expect(await reader.query(api.userNotes.getById, { noteId })).toMatchObject(
      { contentPlain: "My note" },
    );
    expect(
      (await t.run((ctx) => ctx.db.get(noteId)))?.embedding,
    ).toBeUndefined();

    for (const path of ["library", "library/search"]) {
      const response = await reader.fetch(`/api/${path}`, {
        method: "POST",
        body: JSON.stringify({ question: "What did I read?" }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        code: "no_embeddings",
        error: NO_EMBEDDINGS_MESSAGE,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("embeds through OpenAI with the library's own key, preferred over OpenRouter", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    await saveTestCredential(
      t,
      readerLibraryId,
      "openrouter",
      READER_OPENROUTER,
    );
    await saveTestCredential(t, readerLibraryId, "openai", READER_OPENAI);
    const noteId = await readerNote(t, readerLibraryId);
    const { calls } = mockProviders(() =>
      Response.json({ data: [{ index: 0, embedding }] }),
    );
    await t.action(internal.actions.embedUserNote.embed, { noteId });
    await runScheduled(t);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/embeddings");
    expect(calls[0].body.model).toBe("text-embedding-3-small");
    expect(calls[0].headers.get("Authorization")).toBe(
      `Bearer ${READER_OPENAI}`,
    );
    expect((await t.run((ctx) => ctx.db.get(noteId)))?.embedding).toHaveLength(
      1536,
    );
  });
});
