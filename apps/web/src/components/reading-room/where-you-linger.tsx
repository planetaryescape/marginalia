export type LingerTopic = {
  name: string;
  secondsPerParagraph: number;
  paragraphs: number;
  articles: number;
};

/** The topics a paragraph held the reader longest in, with the average in text beside each bar. */
export function WhereYouLinger({ topics }: { topics: LingerTopic[] }) {
  const most = Math.max(1, ...topics.map((t) => t.secondsPerParagraph));
  return (
    <section aria-labelledby="where-you-linger">
      <h2
        id="where-you-linger"
        className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--reader-muted)]"
      >
        Where you linger
      </h2>
      <p className="mb-2 text-xs text-[var(--reader-muted)]">
        Seconds a paragraph held you, averaged over the paragraphs you stayed on
        for at least a second.
      </p>
      {topics.length === 0 ? (
        <p className="text-sm text-[var(--reader-muted)]">
          Nothing has held you long enough in this period to show a pattern.
        </p>
      ) : (
        <ul>
          {topics.map((topic) => (
            <li
              key={topic.name}
              title={`${topic.paragraphs} paragraphs across ${topic.articles} ${topic.articles === 1 ? "article" : "articles"}`}
              className="border-b border-[var(--reader-border)] py-2.5"
            >
              <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                <span className="min-w-0 truncate">{topic.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--reader-muted)]">
                  {topic.secondsPerParagraph} s a paragraph · {topic.paragraphs}{" "}
                  paragraphs
                </span>
              </div>
              <div
                aria-hidden
                className="mt-1.5 h-[5px] rounded-sm"
                style={{
                  width: `${Math.max(1, (topic.secondsPerParagraph / most) * 100)}%`,
                  background:
                    "color-mix(in srgb, var(--reader-fg) 50%, transparent)",
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
