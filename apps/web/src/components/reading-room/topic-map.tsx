import Link from "next/link";

export type Topic = {
  name: string;
  minutes: number;
  articles: number;
  finished: number;
  skipped: number;
};

/** "3 finished · 1 skipped"; a figure of nothing is left out. */
export function outcomes(topic: Pick<Topic, "finished" | "skipped">) {
  return [
    topic.finished > 0 && `${topic.finished} finished`,
    topic.skipped > 0 && `${topic.skipped} skipped`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function spent(minutes: number) {
  return minutes >= 60
    ? `${Math.round(minutes / 60)}h`
    : `${Math.max(1, Math.round(minutes))}m`;
}

/** Topics sized by time read. Renders nothing until some article has a topic. */
export function TopicMap({
  topics,
  paired = [],
}: {
  topics: Topic[];
  /** Topics a merge suggestion names, underlined so the reader can see which */
  paired?: string[];
}) {
  if (topics.length === 0) return null;
  const most = Math.max(1, ...topics.map((t) => t.minutes));
  return (
    <section aria-labelledby="topics">
      <h2
        id="topics"
        className="mb-3 text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--reader-muted)]"
      >
        The topics you return to
      </h2>
      <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 leading-tight">
        {topics.map((topic) => (
          <li
            key={topic.name}
            className={`font-serif text-[var(--reader-fg-soft)] ${
              paired.includes(topic.name)
                ? "underline decoration-[var(--pencil-rule)] underline-offset-4"
                : ""
            }`}
            // Area follows minutes, so the size follows their square root
            style={{
              fontSize: `${(0.9 + 1.1 * Math.sqrt(topic.minutes / most)).toFixed(2)}rem`,
            }}
          >
            <Link
              href={`/library?topic=${encodeURIComponent(topic.name)}`}
              className="underline-offset-4 hover:text-[var(--reader-fg)] hover:underline hover:decoration-[var(--pencil-rule)]"
              title={`Open ${topic.name} in Library`}
            >
              {topic.name}
            </Link>
            <span className="ml-1 font-sans text-[11px] text-[var(--reader-muted)]">
              {spent(topic.minutes)} · {topic.articles}{" "}
              {topic.articles === 1 ? "article" : "articles"}
            </span>
            {outcomes(topic) && (
              <span className="block font-sans text-[11px] text-[var(--reader-muted)]">
                {outcomes(topic)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
