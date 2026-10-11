interface MiniBarProps {
  value: number; // 0-100
  width?: string;
  height?: string;
  color?: string;
}

export function MiniBar({
  value,
  width = "50px",
  height = "3px",
  color = "bg-annotation-crossref",
}: MiniBarProps) {
  return (
    <div
      className="rounded-full bg-[var(--reader-chip)] overflow-hidden"
      style={{ width, height }}
    >
      <div
        className={`h-full rounded-full ${color} transition-all duration-500`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
