/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ownerTest,
  runScheduled,
  saveTestCredential,
  secondReaderTest,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import * as aiModels from "./lib/aiModels";

const modules = import.meta.glob("./**/*.ts");
const scripture = "Licensed provider text, not an article or an AI input";
function provider() {
  return vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.hostname === "bible-api.com")
      return Response.json({
        translation: { identifier: "web" },
        verses: [
          {
            book_id: "JHN",
            chapter: 3,
            verse: 16,
            text: "Public-domain study wording",
          },
        ],
      });
    if (url.pathname.endsWith("/stylesheet"))
      return new Response("/* provider font CSS */");
    if (url.pathname.includes("/passages/"))
      return Response.json({
        id: "JHN.3.16",
        reference: "John 3:16",
        content: `<p>${scripture}</p>`,
      });
    const id = Number(url.pathname.split("/")[3]);
    return Response.json({
      id,
      title: `Version ${id}`,
      abbreviation: `V${id}`,
      language_tag: "en",
      copyright: "Publisher notice",
    });
  });
}
beforeEach(() => {
  vi.stubEnv("YOUVERSION_APP_KEY", "comparison-test-credential");
  vi.stubEnv("YOUVERSION_READING_ENABLED", "true");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("reading-only Bible study boundaries", () => {
  it("does not download and discard licensed text before opening the reader, and reopens saved study sources without network calls", async () => {
    vi.useFakeTimers();
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, {
      enabled: true,
      translation: "niv",
    });
    const fetch = provider();
    vi.stubGlobal("fetch", fetch);
    const id = await t.action(api.actions.bible.openReading, {
      reference: "John 3:16",
    });
    expect(fetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      "bible-api.com",
    ]);
    fetch.mockClear();
    expect(
      await t.action(api.actions.bible.openReading, { reference: "John 3:16" }),
    ).toBe(id);
    expect(fetch).not.toHaveBeenCalled();
    const display = await t.action(api.actions.bible.readComparison, {
      reference: "John 3:16",
      versionIds: [111],
    });
    expect(display.panes[0].html).toContain(scripture);
    expect(
      fetch.mock.calls.filter(([url]) => url.includes("/passages/")),
    ).toHaveLength(1);
  });
  it("still rejects invalid or disabled licensed selections before saving a WEB study source", async () => {
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    const fetch = provider();
    vi.stubGlobal("fetch", fetch);
    for (const versionId of [-1, 0, 1.5]) {
      await expect(
        t.action(api.actions.bible.openReading, {
          reference: "John 3:16",
          versionId,
        }),
      ).rejects.toThrow("different");
    }
    await expect(
      t.action(api.actions.bible.openReading, {
        reference: "John 1-3",
        versionId: 111,
      }),
    ).rejects.toThrow("one chapter");
    vi.stubEnv("YOUVERSION_READING_ENABLED", "false");
    await expect(
      t.action(api.actions.bible.openReading, {
        reference: "John 3:16",
        versionId: 111,
      }),
    ).rejects.toThrow("not enabled");
    expect(fetch).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("articles").take(5))).toEqual([]);
  });
  it("opens the normal reader using a public-domain AI source while keeping licensed display text transient", async () => {
    vi.useFakeTimers();
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, {
      enabled: true,
      translation: "niv",
    });
    vi.stubGlobal("fetch", provider());
    const id = await t.action(api.actions.bible.openReading, {
      reference: "John 3:16",
    });
    const article = await t.query(api.articles.getById, { articleId: id });
    expect(article).toMatchObject({
      content: "3:16 Public-domain study wording",
      bible: { translation: "web", displayVersionId: 111 },
    });
    expect(JSON.stringify(article)).not.toContain(scripture);
    expect(
      await t.action(api.actions.bible.openReading, {
        reference: "John 3:16",
        versionId: 111,
      }),
    ).toBe(id);
    const nasb = await t.action(api.actions.bible.openReading, {
      reference: "John 3:16",
      versionId: 2692,
    });
    expect(nasb).not.toBe(id);
    expect(
      await t.query(internal.bible.studySource, {
        articleId: id,
        userId: "default_user",
      }),
    ).toMatchObject({ content: "3:16 Public-domain study wording" });
    const mark = await t.mutation(api.highlights.create, {
      articleId: id,
      kind: "highlight",
      text: scripture,
      paragraphIndex: 0,
    });
    const note = await t.mutation(api.userNotes.create, {
      articleId: id,
      selectedText: scripture,
      content: "My own idea",
      contentPlain: "My own idea",
    });
    expect(await t.run((ctx) => ctx.db.get(mark))).toMatchObject({
      licensedQuote: true,
    });
    const savedNote = await t.run((ctx) => ctx.db.get(note));
    expect(savedNote?.noteIndex?.input).toBe("My own idea");
    await saveTestCredential(t, "default_user", "anthropic", "fixture-key");
    const generate = vi
      .spyOn(aiModels, "generateObjectWithFallback")
      .mockResolvedValue({
        modelId: "anthropic:fixture",
        object: {
          annotations: [],
          reflection: {
            strongestPoint: "",
            weakestAssumption: "",
            credibleCounterview: "",
            questionForYou: "",
          },
        },
      });
    await runScheduled(t);
    expect(generate).toHaveBeenCalled();
    expect(JSON.stringify(generate.mock.calls)).toContain(
      "Public-domain study wording",
    );
    expect(JSON.stringify(generate.mock.calls)).not.toContain(scripture);
  });
  it("does not let a slow older request retire the newer comparison", async () => {
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fetching = () => {};
    const started = new Promise<void>((resolve) => {
      fetching = resolve;
    });
    let block = true;
    const real = provider();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (block) {
          fetching();
          await gate;
        }
        return real(url);
      }),
    );
    const input = { reference: "John 3:16", versionIds: [111, 2692] };
    const old = t
      .action(api.actions.bible.readComparison, input)
      .catch((error: unknown) => error);
    await started;
    block = false;
    const current = await t.action(api.actions.bible.readComparison, input);
    release();
    const late = await old;
    expect(late).toBeInstanceOf(Error);
    expect(late instanceof Error && late.message).toContain("Another passage");
    expect(await t.query(api.bible.activeLicensedReading, {})).toBe(
      current.token,
    );
  });
  it("does not generate AI for a legacy licensed article even when reading is enabled", async () => {
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    const id = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "legacy-licensed",
        title: "John 3:16",
        url: "https://example.com",
        content: scripture,
        bible: {
          reference: "John 3:16",
          translation: "niv",
          copyright: "notice",
        },
        extractionStatus: "extracted",
        annotationStatus: "pending",
        createdAt: 1,
      }),
    );
    const fetch = provider();
    vi.stubGlobal("fetch", fetch);
    await t.action(internal.actions.generateAnnotations.generateForArticle, {
      articleId: id,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await t.query(api.articles.getById, { articleId: id })).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
      annotationStatus: "skipped",
      skipReason: "licensed_bible_read_only",
    });
  });
  it("never calls the provider before opt-in", async () => {
    const t = await ownerTest(modules);
    const fetch = provider();
    vi.stubGlobal("fetch", fetch);
    await expect(t.action(api.actions.bible.catalogue, {})).rejects.toThrow(
      "Enable Bible",
    );
    await expect(
      t.action(api.actions.bible.readComparison, {
        reference: "John 3:16",
        versionIds: [111, 2692],
      }),
    ).rejects.toThrow("Enable Bible");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns actual text transiently, stores only a display lease and schedules no AI work", async () => {
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, {
      enabled: true,
      translation: "niv",
    });
    vi.stubGlobal("fetch", provider());
    const result = await t.action(api.actions.bible.readComparison, {
      reference: "John 3:16",
      versionIds: [111, 2692],
    });
    expect(result.panes.map((pane) => pane.id)).toEqual([111, 2692]);
    expect(result.panes[0].html).toContain(scripture);
    expect(await t.query(api.bible.activeLicensedReading, {})).toBe(
      result.token,
    );
    const state = await t.run(async (ctx) => ({
      articles: await ctx.db.query("articles").take(10),
      leases: await ctx.db.query("bibleReadingSessions").take(10),
      jobs: await ctx.db.system.query("_scheduled_functions").take(10),
    }));
    expect(state.articles).toEqual([]);
    expect(state.jobs).toEqual([]);
    expect(state.leases).toHaveLength(1);
    expect(JSON.stringify(state)).not.toContain(scripture);
    await expect(
      t.action(api.actions.bible.openPassage, {
        reference: "John 3:16",
        translation: "niv",
      }),
    ).rejects.toThrow("reading-only");
    await expect(
      t.mutation(internal.bible.savePassage, {
        userId: "default_user",
        reference: "John 3:16",
        translation: "niv",
        content: scripture,
        contentHtml: `<p>${scripture}</p>`,
        copyright: "notice",
        url: "https://example.com",
      }),
    ).rejects.toThrow("cannot be saved");
  });
  it("allows one active comparison per reader, isolates readers, and hides on opt-out or provider revocation", async () => {
    const { owner, reader } = await secondReaderTest(modules);
    for (const t of [owner, reader])
      await t.mutation(api.bible.setPreferences, { enabled: true });
    vi.stubGlobal("fetch", provider());
    const input = { reference: "John 3:16", versionIds: [111, 2692] };
    const first = await owner.action(api.actions.bible.readComparison, input);
    const other = await reader.action(api.actions.bible.readComparison, input);
    const next = await owner.action(api.actions.bible.readComparison, input);
    expect(next.token).not.toBe(first.token);
    expect(await owner.query(api.bible.activeLicensedReading, {})).toBe(
      next.token,
    );
    expect(await reader.query(api.bible.activeLicensedReading, {})).toBe(
      other.token,
    );
    await owner.mutation(api.bible.setPreferences, { enabled: false });
    expect(await owner.query(api.bible.activeLicensedReading, {})).toBeNull();
    vi.stubEnv("YOUVERSION_READING_ENABLED", "false");
    expect(await reader.query(api.bible.activeLicensedReading, {})).toBeNull();
  });
  it("lets opt-out win an in-flight passage fetch", async () => {
    const t = await ownerTest(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fetching = () => {};
    const started = new Promise<void>((resolve) => {
      fetching = resolve;
    });
    const real = provider();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetching();
        await gate;
        return real(url);
      }),
    );
    const pending = t.action(api.actions.bible.readComparison, {
      reference: "John 3:16",
      versionIds: [111, 2692],
    });
    await started;
    await t.mutation(api.bible.setPreferences, { enabled: false });
    release();
    await expect(pending).rejects.toThrow("Enable Bible");
    expect(
      await t.run((ctx) => ctx.db.query("bibleReadingSessions").take(10)),
    ).toEqual([]);
  });
});
