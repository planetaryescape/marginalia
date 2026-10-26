export type Habits = {
  timesChosen: { minutes: number; count: number }[];
  anotherPresses: number;
  finishes: number;
  leftUnfinished: number;
};

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      title={hint}
      className="flex items-baseline justify-between gap-3 border-b border-[var(--reader-border)] py-2.5 text-[13.5px]"
    >
      <dt>{label}</dt>
      <dd className="text-right text-xs tabular-nums text-[var(--reader-muted)]">
        {children}
      </dd>
    </div>
  );
}

/** What the reader chose and did over the period, as counts. No target is drawn against them. */
export function HowYouRead({ habits }: { habits: Habits }) {
  const chosen = habits.timesChosen.reduce((n, t) => n + t.count, 0);
  return (
    <section aria-labelledby="how-you-read" className="mt-7">
      <h2
        id="how-you-read"
        className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--reader-muted)]"
      >
        How you read
      </h2>
      <dl>
        <Row
          label="Times you chose"
          hint="How often you picked each time on the desk"
        >
          {chosen === 0
            ? "None"
            : habits.timesChosen
                .map((t) => `${t.minutes} min × ${t.count}`)
                .join(" · ")}
        </Row>
        <Row
          label="Another"
          hint="Times you asked the desk for a different article"
        >
          {count(habits.anotherPresses, "press", "presses")}
        </Row>
        <Row label="Finished" hint="Articles you finished in this period">
          {count(habits.finishes, "article")}
        </Row>
        <Row
          label="Left unfinished"
          hint="Articles you opened in this period and did not finish"
        >
          {count(habits.leftUnfinished, "article")}
        </Row>
      </dl>
    </section>
  );
}
