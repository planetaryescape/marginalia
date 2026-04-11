interface StatDeltaProps {
  current: number;
  previous: number;
  unit?: string;
  invert?: boolean; // true = lower is better (e.g. skipped count)
}

export function StatDelta({
  current,
  previous,
  unit = "",
  invert = false,
}: StatDeltaProps) {
  const diff = current - previous;
  if (diff === 0 && previous === 0) return null;

  const isPositive = invert ? diff < 0 : diff > 0;
  const isNegative = invert ? diff > 0 : diff < 0;
  const arrow = diff > 0 ? "\u2191" : diff < 0 ? "\u2193" : "";
  const color = isPositive
    ? "text-annotation-context"
    : isNegative
      ? "text-annotation-tension"
      : "text-ink-400";

  return (
    <span className={`text-[10px] font-sans ${color}`}>
      {arrow} {Math.abs(diff)}
      {unit} {diff === 0 ? "same" : "vs last week"}
    </span>
  );
}
