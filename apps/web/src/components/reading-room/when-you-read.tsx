const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_LABELS = new Map([
  [0, "12a"],
  [6, "6a"],
  [12, "noon"],
  [18, "6p"],
]);

function hourName(hour: number) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "a.m." : "p.m."}`;
}

/** Four steps of ink, so a cell's depth can be told apart in every theme. */
function cellShade(minutes: number, max: number) {
  if (minutes <= 0) return "var(--reader-chip)";
  const ratio = minutes / max;
  const alpha = ratio > 0.75 ? 85 : ratio > 0.5 ? 62 : ratio > 0.25 ? 42 : 24;
  return `color-mix(in srgb, var(--reader-fg) ${alpha}%, transparent)`;
}

/** Active minutes by weekday and local hour. `heat` is indexed `weekday * 24 + hour`, Monday first. */
export function WhenYouRead({
  heat,
  timeZone,
}: {
  heat: number[];
  timeZone: string;
}) {
  const max = Math.max(0, ...heat);
  const busiest = heat
    .map((minutes, slot) => ({ minutes, slot }))
    .filter((c) => c.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.slot - b.slot)
    .slice(0, 3)
    .map(
      ({ minutes, slot }) =>
        `${DAYS[Math.floor(slot / 24)]} ${hourName(slot % 24)}, ${Math.round(minutes)} minutes`,
    );

  return (
    <section aria-labelledby="when-you-read">
      <h2
        id="when-you-read"
        className="mb-3 text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--reader-muted)]"
      >
        When you read · hour by day
      </h2>
      {max === 0 ? (
        <p className="text-sm text-[var(--reader-muted)]">
          Nothing to show for this period yet.
        </p>
      ) : (
        <>
          <div
            role="img"
            aria-label={`Active reading minutes by weekday and hour. Busiest: ${busiest.join("; ")}.`}
            className="grid gap-[3px] text-[10.5px] text-[var(--reader-muted)]"
            style={{ gridTemplateColumns: "2rem repeat(24, minmax(0, 1fr))" }}
          >
            <span />
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="relative h-3 whitespace-nowrap">
                {HOUR_LABELS.get(hour)}
              </span>
            ))}
            {DAYS.map((day, weekday) => (
              <div key={day} className="contents">
                <span className="self-center">{day}</span>
                {Array.from({ length: 24 }, (_, hour) => {
                  const minutes = heat[weekday * 24 + hour] ?? 0;
                  return (
                    <i
                      key={hour}
                      title={
                        minutes > 0
                          ? `${day} ${hourName(hour)}: ${Math.round(minutes)} min`
                          : undefined
                      }
                      className="h-4 rounded-[2px]"
                      style={{ background: cellShade(minutes, max) }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--reader-muted)]">
            Darker is more minutes, up to {Math.round(max)} in one hour. Hours
            are local ({timeZone}); a visit counts toward the hour it started.
          </p>
        </>
      )}
    </section>
  );
}
