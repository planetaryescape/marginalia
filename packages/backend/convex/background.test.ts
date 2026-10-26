/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addReader,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import { ownerDeploymentReadwiseToken } from "./lib/ownerTransition";
import { decryptProviderKey, encryptProviderKey } from "./lib/providerKeys";

vi.mock("./lib/router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/router")>()),
  embedForLibrary: vi.fn().mockResolvedValue(null),
}));
const modules = import.meta.glob("./**/*.ts");

const OWNER = "default_user";
const DEPLOYMENT_TOKEN = "deployment-readwise-token-fixture";
const READER_TOKEN = "reader-own-readwise-token-0001";
const OWNER_TOKEN = "owner-own-readwise-token-00002";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type T = Awaited<ReturnType<typeof secondReaderTest>>["t"];

async function saveReadwiseToken(t: T, userId: string, token: string) {
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  const sealed = await encryptProviderKey(token, userId, "readwise");
  await t.mutation(internal.readwise.storeToken, {
    userId,
    ...sealed,
    last4: token.slice(-4),
  });
}

async function scheduled(t: T, name: string) {
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").take(500),
  );
  return jobs
    .filter((job) => job.name.includes(name))
    .map((job) => (job.args[0] as { userId: string }).userId);
}

/** Readwise list calls answered with an empty page; records each token used. */
function readwiseApi() {
  const tokens: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("Authorization") ?? "";
    tokens.push(auth.replace(/^Token /, ""));
    if (String(input).includes("/api/v2/auth/"))
      return new Response(null, {
        status:
          auth === `Token ${READER_TOKEN}` || auth === `Token ${OWNER_TOKEN}`
            ? 204
            : 401,
      });
    return new Response(JSON.stringify({ results: [], nextPageCursor: null }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, tokens };
}

describe("background fan-out", () => {
  it("fans the taste, ahead-of-time annotation and tag-merge jobs out to the owner and active readers only", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const disabled = await addReader(t, {
      email: "disabled-taste@example.com",
      status: "disabled",
    });
    for (const [job, name] of [
      ["taste", "taste:recompute"],
      ["preAnnotate", "preAnnotate:start"],
      ["tagMerge", "tagMerge:compute"],
    ] as const) {
      await t.mutation(internal.background.fanOut, { job });
      const users = await scheduled(t, name);
      expect(new Set(users)).toEqual(new Set([OWNER, readerLibraryId]));
      expect(users).not.toContain(disabled.libraryId);
    }
  });

  it("schedules feed polling and queue setup for the owner and active readers only", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const disabled = await addReader(t, {
      email: "disabled@example.com",
      status: "disabled",
    });
    await t.mutation(internal.background.fanOut, { job: "feeds" });
    const feeds = await scheduled(t, "pollFeeds");
    expect(new Set(feeds)).toEqual(new Set([OWNER, readerLibraryId]));
    expect(feeds).not.toContain(disabled.libraryId);
    await t.mutation(internal.background.fanOut, { job: "queue" });
    expect(new Set(await scheduled(t, "readingQueue"))).toEqual(
      new Set([OWNER, readerLibraryId]),
    );
  });

  it("pages through many readers and staggers their jobs", async () => {
    vi.useFakeTimers();
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const extra: string[] = [];
    for (let i = 0; i < 30; i++)
      extra.push(
        (await addReader(t, { email: `reader${i}@example.com` })).libraryId,
      );
    await t.mutation(internal.background.fanOut, { job: "feeds" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(500),
    );
    const polls = jobs.filter((job) => job.name.includes("pollFeeds"));
    const users = polls.map(
      (job) => (job.args[0] as { userId: string }).userId,
    );
    expect(new Set(users)).toEqual(new Set([OWNER, readerLibraryId, ...extra]));
    expect(users).toHaveLength(32);
    const times = new Set(polls.map((job) => job.scheduledTime));
    expect(times.size).toBe(32);
    expect(jobs.filter((job) => job.name.includes("fanOut")).length).toBe(1);
  });

  it("syncs Readwise only for libraries with a token, skipping disabled readers", async () => {
    vi.stubEnv("READWISE_TOKEN", DEPLOYMENT_TOKEN);
    const { t, readerLibraryId } = await secondReaderTest(modules);
    const withoutToken = await addReader(t, { email: "plain@example.com" });
    const disabled = await addReader(t, {
      email: "disabled@example.com",
      status: "disabled",
    });
    await saveReadwiseToken(t, readerLibraryId, READER_TOKEN);
    await saveReadwiseToken(t, disabled.libraryId, READER_TOKEN);
    await t.mutation(internal.background.fanOut, { job: "readwise" });
    const synced = await scheduled(t, "readwiseSync");
    expect(new Set(synced)).toEqual(new Set([OWNER, readerLibraryId]));
    expect(synced).not.toContain(withoutToken.libraryId);
  });
});

describe("per-reader Readwise", () => {
  it("validates, seals and reports a reader's own token, bound to them and to Readwise", async () => {
    // Connecting schedules a first sync; keep it from running into later tests
    vi.useFakeTimers();
    vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    const { fetchMock } = readwiseApi();
    await expect(
      reader.action(api.readwise.connect, { token: "too short" }),
    ).rejects.toThrow("doesn't look like");
    await expect(
      reader.action(api.readwise.connect, {
        token: "refused-readwise-token-000000",
      }),
    ).rejects.toThrow("didn't accept");
    expect(
      await t.run((ctx) => ctx.db.query("readwiseCredentials").take(5)),
    ).toEqual([]);
    expect(
      await reader.action(api.readwise.connect, { token: ` ${READER_TOKEN} ` }),
    ).toEqual({ last4: READER_TOKEN.slice(-4) });
    const validation = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(String(validation?.[0])).toBe("https://readwise.io/api/v2/auth/");
    expect(new Headers(validation?.[1]?.headers).get("Authorization")).toBe(
      `Token ${READER_TOKEN}`,
    );
    const [row] = await t.run((ctx) =>
      ctx.db.query("readwiseCredentials").take(5),
    );
    expect(row.userId).toBe(readerLibraryId);
    expect(JSON.stringify(row)).not.toContain(READER_TOKEN);
    expect(await decryptProviderKey({ ...row, provider: "readwise" })).toBe(
      READER_TOKEN,
    );
    await expect(
      decryptProviderKey({ ...row, provider: "openrouter" }),
    ).rejects.toThrow();
    await expect(
      decryptProviderKey({ ...row, userId: OWNER, provider: "readwise" }),
    ).rejects.toThrow();
    // Never among AI providers
    expect(await reader.query(api.providerCredentials.list, {})).toEqual([]);
    expect(await reader.query(api.readwise.status, {})).toMatchObject({
      connected: true,
      source: "saved",
      last4: READER_TOKEN.slice(-4),
    });
    await reader.mutation(api.readwise.disconnect, {});
    expect((await reader.query(api.readwise.status, {})).connected).toBe(false);
  });

  it("limits Readwise connect attempts per reader", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
    const { reader, owner } = await secondReaderTest(modules);
    const { fetchMock } = readwiseApi();
    for (let i = 0; i < 10; i++)
      await reader.action(api.readwise.connect, { token: READER_TOKEN });
    await expect(
      reader.action(api.readwise.connect, { token: READER_TOKEN }),
    ).rejects.toThrow("Too many attempts");
    expect(fetchMock).toHaveBeenCalledTimes(10);
    await owner.action(api.readwise.connect, { token: OWNER_TOKEN });
  });

  it("uses the deployment token only for the owner, and only until they save their own", async () => {
    vi.stubEnv("READWISE_TOKEN", DEPLOYMENT_TOKEN);
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    expect(ownerDeploymentReadwiseToken(OWNER, false)).toBe(DEPLOYMENT_TOKEN);
    expect(ownerDeploymentReadwiseToken(OWNER, true)).toBeNull();
    expect(ownerDeploymentReadwiseToken(readerLibraryId, false)).toBeNull();
    expect(await owner.query(api.readwise.status, {})).toMatchObject({
      connected: true,
      source: "deployment",
    });
    expect((await reader.query(api.readwise.status, {})).connected).toBe(false);

    const { tokens } = readwiseApi();
    await t.action(internal.actions.readwiseSync.sync, {
      userId: readerLibraryId,
    });
    expect(tokens).toEqual([]);
    await t.action(internal.actions.readwiseSync.sync, { userId: OWNER });
    // Request count depends on the sync window; every request must use this token
    expect(tokens.length).toBeGreaterThan(0);
    expect(new Set(tokens)).toEqual(new Set([DEPLOYMENT_TOKEN]));

    await saveReadwiseToken(t, readerLibraryId, READER_TOKEN);
    await saveReadwiseToken(t, OWNER, OWNER_TOKEN);
    expect(await owner.query(api.readwise.status, {})).toMatchObject({
      source: "saved",
    });
    tokens.length = 0;
    // Each library's lease is its own; clear the pacing left by the run above
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("readwiseSyncState").take(5))
        await ctx.db.patch(row._id, { nextRunAt: 0, leaseUntil: 0 });
    });
    await t.action(internal.actions.readwiseSync.sync, {
      userId: readerLibraryId,
    });
    await t.action(internal.actions.readwiseSync.sync, { userId: OWNER });
    expect(tokens).toEqual([READER_TOKEN, OWNER_TOKEN]);
    expect(tokens).not.toContain(DEPLOYMENT_TOKEN);
  });

  it("does no Readwise work for a disabled reader, even with a saved token", async () => {
    const { t } = await secondReaderTest(modules);
    const disabled = await addReader(t, {
      email: "disabled@example.com",
      status: "disabled",
    });
    await saveReadwiseToken(t, disabled.libraryId, READER_TOKEN);
    const { tokens } = readwiseApi();
    await t.action(internal.actions.readwiseSync.sync, {
      userId: disabled.libraryId,
    });
    expect(tokens).toEqual([]);
  });
});
