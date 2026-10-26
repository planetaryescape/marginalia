/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import { sharedResponseExpiry } from "./lib/bibleResourceCache";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("respects shared HTTP lifetimes, Age, s-maxage, no-store, private and unsupported Vary dimensions", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  expect(
    sharedResponseExpiry(
      new Headers({ "cache-control": "public, max-age=3600", age: "20" }),
      now,
    ),
  ).toBe(now + 3580_000);
  expect(
    sharedResponseExpiry(
      new Headers({ "cache-control": "public, max-age=3600, s-maxage=60" }),
      now,
    ),
  ).toBe(now + 60_000);
  expect(
    sharedResponseExpiry(
      new Headers({
        "cache-control": "public, max-age=3600",
        date: "Mon, 26 Oct 2026 11:30:00 GMT",
      }),
      now,
    ),
  ).toBe(now + 1800_000);
  for (const control of [
    "private, max-age=3600",
    "public, no-store, max-age=3600",
    "public, no-cache, max-age=3600",
    "public, max-age=0",
    "max-age=3600",
  ])
    expect(
      sharedResponseExpiry(new Headers({ "cache-control": control }), now),
    ).toBeNull();
  expect(
    sharedResponseExpiry(
      new Headers({
        "cache-control": "public, max-age=3600",
        vary: "Authorization",
      }),
      now,
    ),
  ).toBeNull();
});

it("shares exact validated responses between readers, keeps notes separate, expires on time and never bypasses the connection gate", async () => {
  vi.useFakeTimers();
  vi.stubEnv("YOUVERSION_APP_KEY", "cache-fixture-credential");
  vi.stubEnv("YOUVERSION_READING_ENABLED", "true");
  const { owner, reader } = await secondReaderTest(modules);
  await owner.mutation(api.bible.setPreferences, {
    enabled: true,
    translation: "niv",
  });
  await reader.mutation(api.bible.setPreferences, {
    enabled: true,
    translation: "niv",
  });
  const fetch = vi.fn(async (url: string) => {
    const headers = {
      "cache-control": url.endsWith("/stylesheet")
        ? "public, max-age=86400"
        : "public, max-age=3600",
    };
    if (url.includes("bible-api.com"))
      return Response.json({
        translation: { identifier: "web" },
        verses: [
          {
            book_id: "JHN",
            chapter: 3,
            verse: 16,
            text: "Shared public-domain source",
          },
        ],
      });
    if (url.endsWith("/stylesheet"))
      return new Response("/* Fonts */", { headers });
    if (url.includes("/passages/"))
      return Response.json(
        {
          id: "JHN.3.16",
          reference: "John 3:16",
          content: "<p>Licensed display canary</p>",
        },
        { headers },
      );
    return Response.json(
      {
        id: 111,
        title: "NIV",
        abbreviation: "NIV",
        language_tag: "en",
        copyright: "Current notice",
      },
      { headers },
    );
  });
  vi.stubGlobal("fetch", fetch);
  const input = { reference: "John 3:16" };
  const ownerId = await owner.action(api.actions.bible.openReading, input);
  const readerId = await reader.action(api.actions.bible.openReading, input);
  expect(ownerId).not.toBe(readerId);
  expect(fetch).toHaveBeenCalledTimes(1);
  const display = { ...input, versionIds: [111] };
  const first = await owner.action(api.bibleReading.readComparison, display);
  expect(fetch).toHaveBeenCalledTimes(4);
  const second = await reader.action(api.bibleReading.readComparison, display);
  expect(second.panes).toEqual(first.panes);
  expect(second.token).not.toBe(first.token);
  expect(fetch).toHaveBeenCalledTimes(4);
  const state = await owner.run(async (ctx) => ({
    cache: await ctx.db.query("bibleResourceCache").take(10),
    articles: await ctx.db.query("articles").take(10),
  }));
  expect(JSON.stringify(state.cache)).not.toContain("cache-fixture-credential");
  expect(JSON.stringify(state.articles)).not.toContain(
    "Licensed display canary",
  );
  vi.setSystemTime(Date.now() + 3600_001);
  await reader.action(api.bibleReading.readComparison, display);
  expect(fetch).toHaveBeenCalledTimes(6); // text + metadata refresh; font remains cached.
  vi.stubEnv("YOUVERSION_READING_ENABLED", "false");
  await expect(
    owner.action(api.bibleReading.readComparison, display),
  ).rejects.toThrow("not enabled");
  expect(fetch).toHaveBeenCalledTimes(6);
  await owner.mutation(internal.bibleResourceCache.put, {
    key: "prune-fixture",
    body: "Old",
    expiresAt: Date.now() + 1000,
  });
  vi.setSystemTime(Date.now() + 1001);
  expect(
    await owner.query(internal.bibleResourceCache.get, {
      key: "prune-fixture",
    }),
  ).toBeNull();
  await owner.mutation(internal.bibleResourceCache.prune, {});
  expect(
    (
      await owner.run((ctx) => ctx.db.query("bibleResourceCache").take(10))
    ).some((row) => row.key === "prune-fixture"),
  ).toBe(false);
});
