import Link from "next/link";

export type SourceRow = {
  feedId: string;
  title: string;
  offered: number;
  opened: number;
  finished: number;
  skipsMost: boolean;
};

const BARS = [
  { key: "offered", tone: 22 },
  { key: "opened", tone: 50 },
  { key: "finished", tone: 85 },
] as const;

/** What each feed offered, what was opened and what was finished. The hint only points to Sources. */
export function YourSources({ feeds }: { feeds: SourceRow[] }) {
  // One scale for all three bars: a feed's articles can be opened from Library
  // or search as well as the desk, so opened can exceed offered
  const most = Math.max(
    1,
    ...feeds.map((f) => Math.max(f.offered, f.opened, f.finished)),
  );
  return (
    <section aria-labelledby="your-sources">
      <h2
        id="your-sources"
        className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--reader-muted)]"
      >
        Your sources · offered, opened, finished
      </h2>
      <p className="mb-2 text-xs text-[var(--reader-muted)]">
        Counted over each feed's whole history, not only this period.
      </p>
      {feeds.length === 0 ? (
        <p className="text-sm text-[var(--reader-muted)]">
          No feed has offered you anything yet.
        </p>
      ) : (
        <ul>
          {feeds.map((feed) => (
            <li
              key={feed.feedId}
              className="border-b border-[var(--reader-border)] py-2.5"
            >
              <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                <span className="min-w-0 truncate">{feed.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--reader-muted)]">
                  {feed.offered} · {feed.opened} · {feed.finished}
                </span>
              </div>
              <div aria-hidden className="mt-1.5 space-y-[3px]">
                {BARS.map(({ key, tone }) => (
                  <div
                    key={key}
                    className="h-[5px] rounded-sm"
                    style={{
                      width: `${Math.min(100, Math.max(feed[key] ? 1 : 0, (feed[key] / most) * 100))}%`,
                      background: `color-mix(in srgb, var(--reader-fg) ${tone}%, transparent)`,
                    }}
                  />
                ))}
              </div>
              <span className="sr-only">
                {feed.offered} offered, {feed.opened} opened, {feed.finished}{" "}
                finished
              </span>
              {feed.skipsMost && (
                <Link
                  href="/feeds"
                  className="mt-1 inline-block text-xs text-[var(--pencil)] underline decoration-[var(--pencil-rule)] underline-offset-4 hover:decoration-[var(--pencil)]"
                >
                  you skip most of this · consider unsubscribing
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
