/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerTest } from "../test/owner";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const DAY = 86_400_000;

afterEach(() => vi.unstubAllGlobals());

type Post = { id: number; daysAgo: number };

function serve(posts: Post[]) {
  const items = posts
    .map(
      (p) => `<item><title>Post ${p.id}</title>
        <link>https://example.com/posts/${p.id}</link>
        <guid isPermaLink="false">post-${p.id}</guid>
        <pubDate>${new Date(Date.now() - p.daysAgo * DAY).toUTCString()}</pubDate></item>`,
    )
    .join("");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>Example</title>${items}</channel></rss>`,
        ),
    ),
  );
}

async function fixture() {
  const t = await ownerTest(modules);
  await t.run((ctx) =>
    ctx.db.insert("feeds", {
      userId: OWNER,
      url: "https://example.com/feed.xml",
      title: "example.com",
      isActive: true,
      createdAt: Date.now(),
    }),
  );
  const poll = () =>
    t.action(internal.actions.pollFeeds.pollAllFeeds, { userId: OWNER });
  const titles = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("articles").collect()).map((a) => a.title).sort(),
    );
  return { t, poll, titles };
}

const sixPosts: Post[] = [1, 2, 3, 4, 5, 6].map((id) => ({
  id,
  daysAgo: id * 3,
}));

describe("polling a newly added feed", () => {
  it("imports only its newest posts, and never the older ones later", async () => {
    const { poll, titles } = await fixture();
    // Out of order, as some feeds are
    serve([...sixPosts].reverse());
    await poll();
    expect(await titles()).toEqual(["Post 1", "Post 2", "Post 3"]);

    await poll();
    expect(await titles()).toEqual(["Post 1", "Post 2", "Post 3"]);

    serve([{ id: 0, daysAgo: 0 }, ...sixPosts]);
    await poll();
    expect(await titles()).toEqual(["Post 0", "Post 1", "Post 2", "Post 3"]);
  });

  it("leaves out posts older than a month, so a quiet feed adds nothing", async () => {
    const { poll, titles } = await fixture();
    serve([
      { id: 1, daysAgo: 20 },
      { id: 2, daysAgo: 40 },
      { id: 3, daysAgo: 900 },
    ]);
    await poll();
    expect(await titles()).toEqual(["Post 1"]);

    const quiet = await fixture();
    serve([{ id: 4, daysAgo: 900 }]);
    await quiet.poll();
    await quiet.poll();
    expect(await quiet.titles()).toEqual([]);
    serve([
      { id: 5, daysAgo: 0 },
      { id: 4, daysAgo: 900 },
    ]);
    await quiet.poll();
    expect(await quiet.titles()).toEqual(["Post 5"]);
  });

  it("skips a post already imported from Readwise Reader by its link", async () => {
    const { t, poll, titles } = await fixture();
    await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: OWNER,
        guid: "https://example.com/posts/1",
        url: "https://example.com/posts/1",
        title: "From Reader",
        readerDocumentId: "reader-1",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    serve(sixPosts);
    await poll();
    expect(await titles()).toEqual(["From Reader", "Post 2", "Post 3"]);
  });

  it("records why a feed failed", async () => {
    const { t, poll } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gone", { status: 410 })),
    );
    await poll();
    const [feed] = await t.run((ctx) => ctx.db.query("feeds").collect());
    expect(feed?.lastError).toBe("Feed returned 410");
  });
});
