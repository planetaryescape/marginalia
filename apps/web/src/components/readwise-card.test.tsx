import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadwiseCard } from "./readwise-card";

const fixture = vi.hoisted(() => {
  const state: {
    error: string | null;
    active: boolean;
    pending: number | null;
    connected: boolean;
  } = { error: null, active: true, pending: null, connected: true };
  return state;
});
vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
  useQuery: () => ({
    connected: fixture.connected,
    source: fixture.connected ? "saved" : null,
    last4: fixture.connected ? "abcd" : null,
    syncedAt: 1,
    checkedAt: 1,
    error: fixture.error,
    progress: {
      active: fixture.active,
      backfilling: true,
      phase: "Later",
      scanned: 125,
      imported: 25,
      linked: 0,
      skipped: 3,
      highlights: 0,
    },
    pendingAnnotations: fixture.pending,
  }),
}));
afterEach(() => {
  fixture.error = null;
  fixture.active = true;
  fixture.pending = null;
  fixture.connected = true;
});

describe("Reader progress", () => {
  it("shows backfill progress rather than claiming the previous sync is complete", () => {
    const html = renderToStaticMarkup(<ReadwiseCard />);
    expect(html).toContain("Importing full library");
    expect(html).toContain("Later");
    expect(html).toContain("125");
    expect(html).toContain("documents checked");
    expect(html).not.toContain("awaiting annotation");
    expect(html).not.toContain("Synced ");
  });
  it("explains saved progress and recovery after failure, separately from the annotation queue", () => {
    fixture.error = "Reader is temporarily unavailable";
    fixture.pending = 15;
    const html = renderToStaticMarkup(<ReadwiseCard />);
    expect(html).toContain("Last sync failed");
    expect(html).toContain("Sync now retries the current page");
    expect(html).toContain(
      "15 articles awaiting annotation across your library",
    );
    expect(html).toContain("Reader is temporarily unavailable");
  });
  it("lets a reader connect their own token, or disconnect a saved one", () => {
    expect(renderToStaticMarkup(<ReadwiseCard />)).toContain("ending abcd");
    fixture.connected = false;
    const html = renderToStaticMarkup(<ReadwiseCard />);
    expect(html).toContain("Not connected");
    expect(html).toContain("Readwise access token");
    expect(html).not.toContain("READWISE_TOKEN");
  });
});
