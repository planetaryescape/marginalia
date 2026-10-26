type Split = { short: number; middle: number; long: number };

const percent = (n: number, total: number) =>
  total ? Math.round((n / total) * 100) : 0;

function Row({ label, split }: { label: string; split: Split }) {
  const total = split.short + split.middle + split.long;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--reader-muted)]">
      <span className="w-16 shrink-0">{label}</span>
      {total === 0 ? (
        <span>No reads</span>
      ) : (
        <>
          <span
            aria-hidden
            className="flex h-2 min-w-32 flex-1 overflow-hidden rounded bg-[var(--reader-chip)]"
          >
            <span
              className="h-full bg-[color-mix(in_srgb,var(--reader-fg)_80%,transparent)]"
              style={{ width: `${percent(split.short, total)}%` }}
            />
            <span
              className="h-full bg-[color-mix(in_srgb,var(--reader-fg)_28%,transparent)]"
              style={{ width: `${percent(split.long, total)}%` }}
            />
          </span>
          <span className="tabular-nums">
            {percent(split.short, total)}% short · {percent(split.long, total)}%
            long · {total} {total === 1 ? "read" : "reads"}
          </span>
        </>
      )}
    </div>
  );
}

/** Weekday against weekend: the share of reads of 10 minutes or less and of 20 minutes or more. */
export function ShortAndLong({
  weekday,
  weekend,
}: {
  weekday: Split;
  weekend: Split;
}) {
  return (
    <section aria-labelledby="short-and-long" className="mt-7">
      <h2
        id="short-and-long"
        className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--reader-muted)]"
      >
        Short against long
      </h2>
      <p className="mt-1 text-xs text-[var(--reader-muted)]">
        Short is 10 minutes or less, long is 20 or more. In between isn't drawn.
      </p>
      <Row label="Weekdays" split={weekday} />
      <Row label="Weekends" split={weekend} />
    </section>
  );
}
