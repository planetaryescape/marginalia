export function BookPosition({
  title,
  number,
  count,
  format,
}: {
  title: string;
  number: number;
  count: number;
  format?: "pdf" | "epub";
}) {
  return (
    <span className="mt-1 block text-[13.5px] text-[var(--ink-muted)]">
      {format === "epub" ? title : `Part ${number} of ${count} · ${title}`}
    </span>
  );
}
