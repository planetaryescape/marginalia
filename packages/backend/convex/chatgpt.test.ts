/// <reference types="vite/client" />
import {
  exportJWK,
  generateKeyPair,
  type CryptoKey as JoseKey,
  SignJWT,
} from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ownerTest,
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { CHATGPT_UNAVAILABLE, sha256Base64Url } from "./lib/chatgpt";
import { openTokens } from "./lib/chatgptTokens";
import { decryptProviderKey } from "./lib/providerKeys";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const CLIENT_ID = "app_chatgpt_client_fixture";
const REDIRECT_URI = "https://reader.example.com/api/chatgpt/callback";
const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
const REVOKE_URL = "https://auth.openai.com/api/accounts/oauth/revoke";
const JWKS_URL = "https://auth.openai.com/.well-known/jwks.json";
const MODELS_URL = "https://api.openai.com/v1/models";
const RESPONSES_URL = "https://api.openai.com/v1/responses";
const ACCESS = "chatgpt-access-token-fixture-0001";
const REFRESH = "chatgpt-refresh-token-fixture-0001";
const READER_OPENAI = "sk-reader-openai-key-fixture-0002";
const FULL_SCOPE =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

const FORBIDDEN_FIELDS = [
  "max_output_tokens",
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "metadata",
  "previous_response_id",
  "background",
  "conversation",
  "truncation",
  "user",
  "prompt",
  "safety_identifier",
  "tools",
  "reasoning",
  "messages",
];

let signingKey: JoseKey;
let otherKey: JoseKey;
let jwks: { keys: unknown[] };

beforeEach(async () => {
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("CHATGPT_PLAN_ENABLED", "");
  vi.stubEnv("CHATGPT_CLIENT_ID", "");
  vi.stubEnv("CHATGPT_REDIRECT_URI", "");
  vi.stubEnv("CHATGPT_CLIENT_SECRET", "");
  if (!signingKey) {
    const pair = await generateKeyPair("RS256", { extractable: true });
    signingKey = pair.privateKey;
    otherKey = (await generateKeyPair("RS256")).privateKey;
    jwks = {
      keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }],
    };
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function enable() {
  vi.stubEnv("CHATGPT_PLAN_ENABLED", "true");
  vi.stubEnv("CHATGPT_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("CHATGPT_REDIRECT_URI", REDIRECT_URI);
}

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: any;
}

type Handler = (call: Call) => Response | Promise<Response>;

/** Answers every request by URL; no real OpenAI endpoint is ever called. */
function mockOpenAI(handlers: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  const routes: Record<string, Handler> = {
    [JWKS_URL]: () => Response.json(jwks),
    [MODELS_URL]: () =>
      Response.json({
        models: [
          {
            slug: "gpt-6-luna",
            display_name: "GPT-6 Luna",
            visibility: "list",
          },
          {
            slug: "gpt-6.1-sol",
            display_name: "GPT-6.1 Sol",
            visibility: "list",
          },
          { slug: "internal-eval", display_name: "Eval", visibility: "hide" },
        ],
      }),
    [RESPONSES_URL]: () => responsesStream(["From your plan."]),
    [REVOKE_URL]: () => new Response(null, { status: 200 }),
    ...handlers,
  };
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const raw = init?.body ? String(init.body) : undefined;
      let body: any;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = Object.fromEntries(new URLSearchParams(raw));
        }
      }
      const call = {
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body,
      };
      calls.push(call);
      const route = routes[url];
      if (!route) throw new Error(`Unexpected request to ${url}`);
      return route(call);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, routes };
}

function responsesStream(
  deltas: string[],
  end: object = {
    type: "response.completed",
    response: { status: "completed" },
  },
) {
  const events = [
    { type: "response.created", response: { status: "in_progress" } },
    ...deltas.map((delta) => ({ type: "response.output_text.delta", delta })),
    end,
  ];
  return new Response(
    events
      .map((e: any) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

async function idToken(
  nonce: string,
  {
    key = signingKey,
    iss = "https://auth.openai.com",
    aud = CLIENT_ID,
    exp = "1h",
  }: { key?: JoseKey; iss?: string; aud?: string; exp?: string | number } = {},
) {
  return new SignJWT({ nonce, email: "plan@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject("user-chatgpt-subject")
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

function tokenResponse(
  nonce: string,
  {
    access = ACCESS,
    refresh = REFRESH,
    scope = FULL_SCOPE,
    expiresIn = 3600,
    token,
  }: {
    access?: string;
    refresh?: string;
    scope?: string;
    expiresIn?: number;
    token?: string;
  } = {},
): Handler {
  return async () =>
    Response.json({
      access_token: access,
      refresh_token: refresh,
      id_token: token ?? (await idToken(nonce)),
      expires_in: expiresIn,
      scope,
      token_type: "Bearer",
    });
}

type Client = Awaited<ReturnType<typeof ownerTest>>;
type ActionClient = Pick<Client, "action">;

async function begin(client: ActionClient, consent?: boolean) {
  const { url } = await client.action(
    api.chatgpt.start,
    consent ? { consent } : {},
  );
  const params = new URL(url).searchParams;
  return {
    url: new URL(url),
    params,
    state: params.get("state") ?? "",
    nonce: params.get("nonce") ?? "",
  };
}

/** Signs in with ChatGPT end to end against the mocked OpenAI. */
async function connect(
  client: ActionClient,
  token: Parameters<typeof tokenResponse>[1] = {},
) {
  const mock = mockOpenAI();
  const { state, nonce } = await begin(client);
  mock.routes[TOKEN_URL] = tokenResponse(nonce, token);
  const result = await client.action(api.chatgpt.complete, {
    state,
    code: "authorization-code-fixture",
  });
  return { ...mock, result };
}

async function connectionRows(t: Pick<Client, "run">) {
  return t.run((ctx) => ctx.db.query("chatgptConnections").take(10));
}

const companionBody = JSON.stringify({
  mode: "explain",
  title: "An article",
  paragraphs: ["A passage"],
  selection: "A passage",
  paragraphIndex: 0,
});
const companion = (client: Pick<Client, "fetch">) =>
  client.fetch("/api/companion", { method: "POST", body: companionBody });

describe("ChatGPT off by default", () => {
  it("adds nothing and refuses every step while the server isn't configured", async () => {
    const t = await ownerTest(modules);
    await saveTestCredential(t, OWNER, "openai", READER_OPENAI);
    // Even a stray connection row changes nothing while ChatGPT is off
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("chatgptConnections", {
        userId: OWNER,
        subject: "s",
        clientId: CLIENT_ID,
        ciphertext: "x",
        iv: "y",
        scopes: FULL_SCOPE.split(" "),
        planEnabled: true,
        expiresAt: now + 3_600_000,
        status: "connected",
        models: [{ id: "chatgpt:gpt-6-luna", name: "GPT-6 Luna" }],
        modelsAt: now,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const { fetchMock, calls } = mockOpenAI({
      "https://api.openai.com/v1/chat/completions": () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Key answer." } }] })}\n\ndata: [DONE]\n\n`,
        ),
    });

    expect(await t.query(api.providerCredentials.capabilities, {})).toEqual({
      text: true,
      embeddings: true,
      providers: ["openai"],
    });
    expect(await t.query(api.chatgpt.connection, {})).toBeNull();
    const models = await t.query(api.userSettings.getModels, {});
    expect(models.available.map((m) => m.provider)).toEqual([
      "openai",
      "openai",
    ]);
    await expect(
      t.mutation(api.userSettings.setModel, {
        role: "quick",
        model: "chatgpt:gpt-6-luna",
      }),
    ).rejects.toThrow("isn't available");
    await expect(t.action(api.chatgpt.start, {})).rejects.toThrow(
      CHATGPT_UNAVAILABLE,
    );
    expect(
      await t.action(api.chatgpt.complete, { state: "s", code: "c" }),
    ).toEqual({ status: "unavailable" });

    const response = await companion(t);
    expect(await response.text()).toBe("Key answer.");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.openai.com/v1/chat/completions",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      await t.run((ctx) => ctx.db.query("chatgptAuthAttempts").take(5)),
    ).toEqual([]);
  });

  it("treats a partial configuration as off", async () => {
    vi.stubEnv("CHATGPT_PLAN_ENABLED", "true");
    vi.stubEnv("CHATGPT_CLIENT_ID", CLIENT_ID);
    const t = await ownerTest(modules);
    expect(await t.query(api.chatgpt.connection, {})).toBeNull();
    vi.stubEnv("CHATGPT_REDIRECT_URI", "http://127.0.0.1:1455/callback");
    expect(await t.query(api.chatgpt.connection, {})).toBeNull();
    await expect(t.action(api.chatgpt.start, {})).rejects.toThrow(
      CHATGPT_UNAVAILABLE,
    );
  });
});

describe("starting Sign in with ChatGPT", () => {
  it("returns the authorize URL with PKCE, state and nonce, keeping the verifier server-side", async () => {
    enable();
    const t = await ownerTest(modules);
    expect(await t.query(api.chatgpt.connection, {})).toEqual({
      connection: null,
    });
    expect(
      await t.query(api.providerCredentials.capabilities, {}),
    ).toMatchObject({ chatgptAvailable: true, providers: [] });
    const { fetchMock } = mockOpenAI();
    const { url, params, state, nonce } = await begin(t);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://auth.openai.com/api/accounts/authorize",
    );
    expect([...params.keys()].sort()).toEqual(
      [
        "client_id",
        "code_challenge",
        "code_challenge_method",
        "nonce",
        "redirect_uri",
        "resource",
        "response_type",
        "scope",
        "state",
      ].sort(),
    );
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(params.get("scope")).toBe(FULL_SCOPE);
    expect(params.get("resource")).toBe("https://api.openai.com/v1");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fetchMock).not.toHaveBeenCalled();

    const [attempt] = await t.run((ctx) =>
      ctx.db.query("chatgptAuthAttempts").take(5),
    );
    expect(attempt.userId).toBe(OWNER);
    expect(attempt.stateHash).toBe(await sha256Base64Url(state));
    expect(JSON.stringify(attempt)).not.toContain(state);
    const verifier = await decryptProviderKey({
      userId: OWNER,
      provider: "chatgpt-sign-in",
      ciphertext: attempt.verifierCiphertext,
      iv: attempt.verifierIv,
    });
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(params.get("code_challenge")).toBe(await sha256Base64Url(verifier));
    expect(url.toString()).not.toContain(verifier);
    expect(attempt.expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60_000);

    const retry = await begin(t, true);
    expect(retry.params.get("prompt")).toBe("consent");
    // A new sign-in replaces the pending one
    expect(
      await t.run((ctx) => ctx.db.query("chatgptAuthAttempts").take(5)),
    ).toHaveLength(1);
  });
});

describe("the sign-in callback", () => {
  it("rejects unknown, expired and reused states", async () => {
    enable();
    const t = await ownerTest(modules);
    const mock = mockOpenAI();
    expect(
      await t.action(api.chatgpt.complete, { state: "unknown", code: "c" }),
    ).toEqual({ status: "expired" });

    const expired = await begin(t);
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("chatgptAuthAttempts").take(1);
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    expect(
      await t.action(api.chatgpt.complete, { state: expired.state, code: "c" }),
    ).toEqual({ status: "expired" });

    const { state, nonce } = await begin(t);
    mock.routes[TOKEN_URL] = tokenResponse(nonce);
    expect(await t.action(api.chatgpt.complete, { state, code: "c" })).toEqual({
      status: "connected",
    });
    expect(await t.action(api.chatgpt.complete, { state, code: "c" })).toEqual({
      status: "expired",
    });
    expect(mock.calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  it("handles a cancelled sign-in without calling OpenAI", async () => {
    enable();
    const t = await ownerTest(modules);
    const { fetchMock } = mockOpenAI();
    const { state } = await begin(t);
    expect(
      await t.action(api.chatgpt.complete, { state, error: "access_denied" }),
    ).toEqual({ status: "denied" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await connectionRows(t)).toEqual([]);
  });

  it("exchanges the code with PKCE and treats invalid_grant as a restart", async () => {
    enable();
    const t = await ownerTest(modules);
    const mock = mockOpenAI({
      [TOKEN_URL]: () =>
        Response.json({ error: "invalid_grant" }, { status: 400 }),
    });
    const { state } = await begin(t);
    expect(
      await t.action(api.chatgpt.complete, { state, code: "code-1" }),
    ).toEqual({ status: "expired" });
    const [exchange] = mock.calls;
    expect(exchange.url).toBe(TOKEN_URL);
    expect(exchange.headers.get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(exchange.headers.get("Authorization")).toBeNull();
    expect(Object.keys(exchange.body).sort()).toEqual(
      [
        "client_id",
        "code",
        "code_verifier",
        "grant_type",
        "redirect_uri",
        "resource",
      ].sort(),
    );
    expect(exchange.body).toMatchObject({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: "code-1",
      redirect_uri: REDIRECT_URI,
      resource: "https://api.openai.com/v1",
    });
    expect(await connectionRows(t)).toEqual([]);
  });

  it("sends a confidential client's secret only by Basic auth", async () => {
    enable();
    vi.stubEnv("CHATGPT_CLIENT_SECRET", "client-secret-fixture");
    const t = await ownerTest(modules);
    const { calls, result } = await connect(t);
    expect(result).toEqual({ status: "connected" });
    const exchange = calls.find((c) => c.url === TOKEN_URL)!;
    expect(exchange.headers.get("Authorization")).toBe(
      `Basic ${btoa(`${CLIENT_ID}:client-secret-fixture`)}`,
    );
    expect(JSON.stringify(exchange.body)).not.toContain(
      "client-secret-fixture",
    );
  });

  it.each([
    ["a bad signature", { key: "other" }],
    ["the wrong issuer", { iss: "https://evil.example.com" }],
    ["the wrong audience", { aud: "someone-else" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 600 }],
    ["the wrong nonce", { nonce: "not-the-nonce" }],
  ])("rejects an ID token with %s", async (_, change: any) => {
    enable();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await ownerTest(modules);
    const mock = mockOpenAI();
    const { state, nonce } = await begin(t);
    const token = await idToken(change.nonce ?? nonce, {
      ...change,
      key: change.key === "other" ? otherKey : signingKey,
    });
    mock.routes[TOKEN_URL] = tokenResponse(nonce, { token });
    expect(await t.action(api.chatgpt.complete, { state, code: "c" })).toEqual({
      status: "failed",
    });
    expect(await connectionRows(t)).toEqual([]);
    expect(mock.calls.some((c) => c.url === MODELS_URL)).toBe(false);
  });

  it("keeps a connection without plan scope but never answers with it", async () => {
    enable();
    const t = await ownerTest(modules);
    const { result, calls } = await connect(t, {
      scope: "openid profile email offline_access resource.invoke",
    });
    expect(result).toEqual({ status: "plan_disabled" });
    expect(calls.some((c) => c.url === MODELS_URL)).toBe(false);
    expect(await t.query(api.chatgpt.connection, {})).toMatchObject({
      connection: {
        status: "plan_disabled",
        message: expect.stringContaining("allow plan usage"),
      },
    });
    expect(
      await t.query(api.providerCredentials.capabilities, {}),
    ).toMatchObject({ text: false, providers: [] });
    const { fetchMock } = mockOpenAI();
    const response = await companion(t);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "no_provider" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores the tokens sealed and lists the plan's visible models", async () => {
    enable();
    const t = await ownerTest(modules);
    const { result, calls } = await connect(t);
    expect(result).toEqual({ status: "connected" });
    const models = calls.find((c) => c.url === MODELS_URL)!;
    expect(models.headers.get("Authorization")).toBe(`Bearer ${ACCESS}`);

    const [row] = await connectionRows(t);
    expect(row).toMatchObject({
      userId: OWNER,
      subject: "user-chatgpt-subject",
      email: "plan@example.com",
      clientId: CLIENT_ID,
      status: "connected",
      planEnabled: true,
      models: [
        { id: "chatgpt:gpt-6-luna", name: "GPT-6 Luna" },
        { id: "chatgpt:gpt-6.1-sol", name: "GPT-6.1 Sol" },
      ],
    });
    const visible = JSON.stringify([
      await t.query(api.chatgpt.connection, {}),
      await t.query(api.providerCredentials.capabilities, {}),
      await t.query(api.userSettings.getModels, {}),
      await t.query(api.providerCredentials.list, {}),
    ]);
    for (const secret of [ACCESS, REFRESH, row.ciphertext!, row.iv!]) {
      expect(visible).not.toContain(secret);
    }
    for (const secret of [ACCESS, REFRESH])
      expect(JSON.stringify(row)).not.toContain(secret);
    expect(
      await openTokens(OWNER, { ciphertext: row.ciphertext!, iv: row.iv! }),
    ).toMatchObject({
      access_token: ACCESS,
      refresh_token: REFRESH,
    });

    expect(await t.query(api.chatgpt.connection, {})).toEqual({
      connection: {
        email: "plan@example.com",
        status: "connected",
        message: null,
        models: 2,
        connectedAt: row.createdAt,
      },
    });
    expect(await t.query(api.providerCredentials.capabilities, {})).toEqual({
      text: true,
      embeddings: false,
      providers: ["chatgpt"],
      chatgptAvailable: true,
    });
    expect(await t.query(api.userSettings.getModels, {})).toEqual({
      selected: {
        annotations: "chatgpt:gpt-6-luna",
        quick: "chatgpt:gpt-6-luna",
        deep: "chatgpt:gpt-6.1-sol",
      },
      available: [
        { id: "chatgpt:gpt-6-luna", name: "GPT-6 Luna", provider: "chatgpt" },
        { id: "chatgpt:gpt-6.1-sol", name: "GPT-6.1 Sol", provider: "chatgpt" },
      ],
    });
  });
});

async function expireSoon(t: Pick<Client, "run">) {
  await t.run(async (ctx) => {
    const [row] = await ctx.db.query("chatgptConnections").take(1);
    await ctx.db.patch(row._id, { expiresAt: Date.now() + 60_000 });
  });
}

describe("refreshing ChatGPT tokens", () => {
  it("Stop abandons a waiter but lets a rotating refresh finish for another request", async () => {
    enable();
    const t = await ownerTest(modules);
    await connect(t);
    await expireSoon(t);
    let started!: () => void;
    let finish!: () => void;
    const refreshing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const release = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const mock = mockOpenAI({
      [TOKEN_URL]: async () => {
        started();
        await release;
        return Response.json({
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
          scope: FULL_SCOPE,
        });
      },
    });
    const controller = new AbortController();
    const stopped = t.fetch("/api/companion", {
      method: "POST",
      body: companionBody,
      signal: controller.signal,
    });
    await refreshing;
    const other = companion(t);
    controller.abort();
    expect((await stopped).status).toBe(499);
    finish();
    expect(await (await other).text()).toBe("From your plan.");
    expect(mock.calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(1);
    const [row] = await connectionRows(t);
    expect(
      await openTokens(OWNER, { ciphertext: row.ciphertext!, iv: row.iv! }),
    ).toMatchObject({
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
    });
    expect(
      mock.calls.filter((call) => call.url === RESPONSES_URL),
    ).toHaveLength(1);
  });
  it("does not refresh a plan for find or an API-key-only selected chain", async () => {
    enable();
    const t = await ownerTest(modules);
    await connect(t);
    await expireSoon(t);
    await saveTestCredential(t, OWNER, "openai", READER_OPENAI);
    const embedding = Array.from({ length: 1536 }, () => 1);
    const mock = mockOpenAI({
      "https://api.openai.com/v1/embeddings": () =>
        Response.json({ data: [{ index: 0, embedding }] }),
      "https://api.openai.com/v1/chat/completions": () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"API answer"}}]}\n\ndata: [DONE]\n\n',
        ),
      [TOKEN_URL]: () => {
        throw new Error("Unneeded plan refresh");
      },
    });
    const found = await t.fetch("/api/library/find", {
      method: "POST",
      body: JSON.stringify({ question: "fixture" }),
    });
    expect(found.status).toBe(200);
    expect(await (await companion(t)).text()).toBe("API answer");
    expect(mock.calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(0);
  });
  it("refreshes a token about to expire and stores the rotated tokens together", async () => {
    enable();
    const t = await ownerTest(modules);
    await connect(t);
    await expireSoon(t);
    const [before] = await connectionRows(t);
    const mock = mockOpenAI({
      [TOKEN_URL]: () =>
        Response.json({
          access_token: "chatgpt-access-token-rotated",
          refresh_token: "chatgpt-refresh-token-rotated",
          expires_in: 3600,
          scope: FULL_SCOPE,
        }),
    });
    expect(await (await companion(t)).text()).toBe("From your plan.");
    const refresh = mock.calls.filter((c) => c.url === TOKEN_URL);
    expect(refresh).toHaveLength(1);
    expect(refresh[0].body).toEqual({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: REFRESH,
      resource: "https://api.openai.com/v1",
    });
    const answer = mock.calls.find((c) => c.url === RESPONSES_URL)!;
    expect(answer.headers.get("Authorization")).toBe(
      "Bearer chatgpt-access-token-rotated",
    );
    const [after] = await connectionRows(t);
    expect(after.version).toBe(before.version + 1);
    expect(after.refreshLease).toBeUndefined();
    expect(after.expiresAt).toBeGreaterThan(Date.now() + 3_000_000);
    expect(
      await openTokens(OWNER, { ciphertext: after.ciphertext!, iv: after.iv! }),
    ).toMatchObject({
      access_token: "chatgpt-access-token-rotated",
      refresh_token: "chatgpt-refresh-token-rotated",
    });
  });

  it("serializes concurrent refreshes so a rotated refresh token is spent once", async () => {
    enable();
    const t = await ownerTest(modules);
    await connect(t);
    await expireSoon(t);
    let refreshes = 0;
    const mock = mockOpenAI({
      [TOKEN_URL]: async () => {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return Response.json({
          access_token: `chatgpt-access-token-rotated-${refreshes}`,
          refresh_token: `chatgpt-refresh-token-rotated-${refreshes}`,
          expires_in: 3600,
          scope: FULL_SCOPE,
        });
      },
    });
    const answers = await Promise.all([companion(t), companion(t)]);
    expect(await Promise.all(answers.map((a) => a.text()))).toEqual([
      "From your plan.",
      "From your plan.",
    ]);
    expect(refreshes).toBe(1);
    const tokens = mock.calls
      .filter((c) => c.url === RESPONSES_URL)
      .map((c) => c.headers.get("Authorization"));
    expect(tokens).toEqual([
      "Bearer chatgpt-access-token-rotated-1",
      "Bearer chatgpt-access-token-rotated-1",
    ]);
  });

  it.each([
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
  ])("asks the reader to reconnect after %s", async (code) => {
    enable();
    const t = await ownerTest(modules);
    await connect(t);
    await expireSoon(t);
    const mock = mockOpenAI({
      [TOKEN_URL]: () => Response.json({ error: code }, { status: 400 }),
    });
    const response = await companion(t);
    expect(response.status).toBe(401);
    expect(mock.calls.some((c) => c.url === RESPONSES_URL)).toBe(false);
    const [row] = await connectionRows(t);
    expect(row.status).toBe("reconnect");
    expect(row.ciphertext).toBeUndefined();
    expect(row.iv).toBeUndefined();
    expect(await t.query(api.chatgpt.connection, {})).toMatchObject({
      connection: {
        status: "reconnect",
        message: expect.stringContaining("Reconnect"),
      },
    });
  });

  it("reports invalid_client as a server configuration error and keeps the tokens", async () => {
    enable();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await ownerTest(modules);
    await connect(t);
    await expireSoon(t);
    const [before] = await connectionRows(t);
    mockOpenAI({
      [TOKEN_URL]: () =>
        Response.json({ error: "invalid_client" }, { status: 401 }),
    });
    expect((await companion(t)).status).toBe(409);
    expect(
      errors.mock.calls.some((args) =>
        String(args[0]).includes("invalid_client"),
      ),
    ).toBe(true);
    const [after] = await connectionRows(t);
    expect(after.ciphertext).toBe(before.ciphertext);
    expect(after.status).toBe("connected");
    expect(after.refreshLease).toBeUndefined();
  });
});

describe("answering with a ChatGPT plan", () => {
  it("sends only the allowed Responses fields and streams to completion", async () => {
    enable();
    const t = await ownerTest(modules);
    await connect(t);
    const mock = mockOpenAI({
      [RESPONSES_URL]: () => responsesStream(["From ", "your ", "plan."]),
    });
    const response = await companion(t);
    expect(response.headers.get("X-Companion-Model")).toBe(
      "chatgpt:gpt-6-luna",
    );
    expect(await response.text()).toBe("From your plan.");
    const [call] = mock.calls;
    expect(call.url).toBe(RESPONSES_URL);
    expect(call.headers.get("Authorization")).toBe(`Bearer ${ACCESS}`);
    expect(Object.keys(call.body).sort()).toEqual(
      ["input", "instructions", "model", "store", "stream"].sort(),
    );
    expect(call.body).toMatchObject({
      model: "gpt-6-luna",
      store: false,
      stream: true,
    });
    expect(typeof call.body.instructions).toBe("string");
    expect(Array.isArray(call.body.input)).toBe(true);
    expect(
      call.body.input.some((item: { role: string }) => item.role === "system"),
    ).toBe(false);
    for (const field of FORBIDDEN_FIELDS)
      expect(call.body).not.toHaveProperty(field);
  });

  it("fails a stream that ends before response.completed", async () => {
    enable();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await ownerTest(modules);
    await connect(t);
    mockOpenAI({
      [RESPONSES_URL]: () =>
        responsesStream(["Partial"], {
          type: "response.output_text.delta",
          delta: " answer",
        }),
    });
    const response = await companion(t);
    await expect(response.text()).rejects.toThrow("interrupted");
  });

  it("summarises without an output cap and validates the JSON", async () => {
    enable();
    const t = await ownerTest(modules);
    await connect(t);
    const articleId: Id<"articles"> = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: OWNER,
        guid: "plan-summary",
        url: "https://example.com/plan-summary",
        title: "Plan article",
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
    const json = JSON.stringify(summary);
    const mock = mockOpenAI({
      [RESPONSES_URL]: () =>
        responsesStream([json.slice(0, 20), json.slice(20)]),
    });
    await t.action(api.actions.summarize.generate, {
      articleId,
      title: "Plan article",
      paragraphs: ["Rest supports clear thinking."],
    });
    const [call] = mock.calls;
    expect(call.url).toBe(RESPONSES_URL);
    expect(call.body).toMatchObject({ store: false, stream: true });
    expect(Object.keys(call.body).sort()).toEqual(
      ["input", "instructions", "model", "store", "stream"].sort(),
    );
    for (const field of FORBIDDEN_FIELDS)
      expect(call.body).not.toHaveProperty(field);
    expect(call.body.instructions).toContain("JSON Schema");
    expect(
      await t.query(api.summaries.getByArticle, { articleId }),
    ).toMatchObject({ gist: "Rest is useful.", model: "chatgpt:gpt-6-luna" });
  });

  it("shows a usage-limit failure instead of falling back to an API key", async () => {
    enable();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await ownerTest(modules);
    await saveTestCredential(t, OWNER, "openai", READER_OPENAI);
    await connect(t);
    await t.mutation(api.userSettings.setModel, {
      role: "quick",
      model: "chatgpt:gpt-6-luna",
    });
    const mock = mockOpenAI({
      [RESPONSES_URL]: () =>
        responsesStream([], {
          type: "response.failed",
          response: {
            status: "failed",
            error: {
              code: "subscription_sharing_usage_limit_exceeded",
              message: "Usage limit reached",
            },
          },
        }),
    });
    const response = await companion(t);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      code: "chatgpt_usage_limit",
      error: expect.stringContaining("https://chatgpt.com/settings/usage"),
    });
    expect(mock.calls.map((c) => c.url)).toEqual([RESPONSES_URL]);

    // The same for an HTTP 429 with the code in the body
    const http = mockOpenAI({
      [RESPONSES_URL]: () =>
        Response.json(
          { error: { code: "subscription_sharing_usage_limit_exceeded" } },
          { status: 429 },
        ),
    });
    expect((await companion(t)).status).toBe(429);
    expect(http.calls.map((c) => c.url)).toEqual([RESPONSES_URL]);
  });

  it("marks the plan unavailable when the reader isn't eligible", async () => {
    enable();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await ownerTest(modules);
    await saveTestCredential(t, OWNER, "openai", READER_OPENAI);
    await connect(t);
    await t.mutation(api.userSettings.setModel, {
      role: "quick",
      model: "chatgpt:gpt-6-luna",
    });
    const mock = mockOpenAI({
      [RESPONSES_URL]: () =>
        Response.json(
          {
            detail: "Not eligible",
            code: "subscription_sharing_user_not_eligible",
          },
          { status: 403 },
        ),
    });
    const response = await companion(t);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "chatgpt_not_eligible",
    });
    expect(mock.calls.map((c) => c.url)).toEqual([RESPONSES_URL]);
    expect(await t.query(api.chatgpt.connection, {})).toMatchObject({
      connection: { status: "plan_disabled" },
    });
    expect(
      (await t.query(api.providerCredentials.capabilities, {})).providers,
    ).toEqual(["openai"]);
  });

  it("asks the reader to reconnect after invalid_user", async () => {
    enable();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await ownerTest(modules);
    await connect(t);
    mockOpenAI({
      [RESPONSES_URL]: () =>
        Response.json({ error: { code: "invalid_user" } }, { status: 401 }),
    });
    const response = await companion(t);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "chatgpt_reconnect" });
    const [row] = await connectionRows(t);
    expect(row.status).toBe("reconnect");
    expect(row.ciphertext).toBeUndefined();
  });

  it("falls back to the reader's next model after a 5xx before the first token", async () => {
    enable();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await ownerTest(modules);
    await saveTestCredential(t, OWNER, "openai", READER_OPENAI);
    await connect(t);
    await t.mutation(api.userSettings.setModel, {
      role: "quick",
      model: "chatgpt:gpt-6-luna",
    });
    const mock = mockOpenAI({
      [RESPONSES_URL]: () =>
        Response.json({ detail: "Service unavailable" }, { status: 503 }),
      "https://api.openai.com/v1/chat/completions": () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "From OpenAI." } }] })}\n\ndata: [DONE]\n\n`,
        ),
    });
    const response = await companion(t);
    expect(await response.text()).toBe("From OpenAI.");
    expect(response.headers.get("X-Companion-Model")).toBe("openai:gpt-6-luna");
    expect(mock.calls.map((c) => c.url)).toEqual([
      RESPONSES_URL,
      "https://api.openai.com/v1/chat/completions",
    ]);
    expect(mock.calls[1].headers.get("Authorization")).toBe(
      `Bearer ${READER_OPENAI}`,
    );
  });

  it("ranks library search with the plan, embedding with the reader's OpenAI key", async () => {
    enable();
    const t = await ownerTest(modules);
    await saveTestCredential(t, OWNER, "openai", READER_OPENAI);
    await connect(t);
    await t.mutation(api.userSettings.setModel, {
      role: "quick",
      model: "chatgpt:gpt-6-luna",
    });
    const embedding = Array.from({ length: 1536 }, () => 1);
    const articleId = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: OWNER,
        guid: "sleep",
        url: "https://example.com/sleep",
        title: "Sleep in daily life",
        excerpt: "Sleep",
        embedding,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    const matches = JSON.stringify({
      matches: [{ articleId, relevant: true, reason: "About sleep." }],
    });
    const mock = mockOpenAI({
      "https://api.openai.com/v1/embeddings": () =>
        Response.json({ data: [{ index: 0, embedding }] }),
      [RESPONSES_URL]: () =>
        responsesStream([`\`\`\`json\n${matches}\n\`\`\``]),
    });
    const response = await t.fetch("/api/library/search", {
      method: "POST",
      body: JSON.stringify({ question: "sleep" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      matches: [{ articleId, reason: "About sleep." }],
    });
    const embed = mock.calls.find((c) => c.url.endsWith("/embeddings"))!;
    expect(embed.headers.get("Authorization")).toBe(`Bearer ${READER_OPENAI}`);
    const rank = mock.calls.find((c) => c.url === RESPONSES_URL)!;
    expect(rank.headers.get("Authorization")).toBe(`Bearer ${ACCESS}`);
    expect(Object.keys(rank.body).sort()).toEqual(
      ["input", "instructions", "model", "store", "stream"].sort(),
    );
    for (const field of FORBIDDEN_FIELDS)
      expect(rank.body).not.toHaveProperty(field);
    expect(rank.body.instructions).toContain('"matches"');
  });

  it("never embeds through ChatGPT", async () => {
    enable();
    const t = await ownerTest(modules);
    await connect(t);
    const { fetchMock } = mockOpenAI();
    const response = await t.fetch("/api/library/search", {
      method: "POST",
      body: JSON.stringify({ question: "What did I read?" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "no_embeddings" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("disconnecting ChatGPT", () => {
  it("revokes the refresh token and deletes the connection", async () => {
    enable();
    const t = await ownerTest(modules);
    await connect(t);
    const mock = mockOpenAI();
    expect(await t.action(api.chatgpt.disconnect, {})).toEqual({
      revoked: true,
    });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].url).toBe(REVOKE_URL);
    expect(mock.calls[0].body).toEqual({
      token: REFRESH,
      token_type_hint: "refresh_token",
      client_id: CLIENT_ID,
    });
    expect(await connectionRows(t)).toEqual([]);
    expect(await t.query(api.chatgpt.connection, {})).toEqual({
      connection: null,
    });
  });

  it("deletes the tokens even when revocation fails", async () => {
    enable();
    const t = await ownerTest(modules);
    await connect(t);
    mockOpenAI({ [REVOKE_URL]: () => new Response("nope", { status: 500 }) });
    expect(await t.action(api.chatgpt.disconnect, {})).toEqual({
      revoked: false,
    });
    expect(await connectionRows(t)).toEqual([]);
  });
});

describe("ChatGPT connections stay in their own library", () => {
  it("lets a second reader neither see, use nor disconnect the owner's plan", async () => {
    enable();
    const { t, owner, reader } = await secondReaderTest(modules);
    await connect(owner);
    const { fetchMock } = mockOpenAI();
    expect(await reader.query(api.chatgpt.connection, {})).toEqual({
      connection: null,
    });
    expect(
      await reader.query(api.providerCredentials.capabilities, {}),
    ).toMatchObject({ text: false, providers: [] });
    expect(
      (await reader.query(api.userSettings.getModels, {})).available,
    ).toEqual([]);
    expect(await reader.action(api.chatgpt.disconnect, {})).toEqual({
      revoked: true,
    });
    expect(await connectionRows(t)).toHaveLength(1);
    expect((await companion(reader)).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("won't let another reader complete the owner's sign-in", async () => {
    enable();
    const { t, owner, reader } = await secondReaderTest(modules);
    const mock = mockOpenAI();
    const { state, nonce } = await begin(owner);
    mock.routes[TOKEN_URL] = tokenResponse(nonce);
    expect(
      await reader.action(api.chatgpt.complete, { state, code: "c" }),
    ).toEqual({ status: "expired" });
    expect(mock.calls).toHaveLength(0);
    expect(await connectionRows(t)).toEqual([]);
    // The owner's own sign-in still works
    expect(
      await owner.action(api.chatgpt.complete, { state, code: "c" }),
    ).toEqual({ status: "connected" });
    const [row] = await connectionRows(t);
    expect(row.userId).toBe(OWNER);
  });
});
