import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadwiseCard } from "./readwise-card";

const fixture = vi.hoisted(() => {
  const state: {
    error: string | null;
    active: boolean;
    pending: number | null;
  } = { error: null, active: true, pending: null };
  return state;
});
vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useQuery: () => ({
    connected: true,
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
});
