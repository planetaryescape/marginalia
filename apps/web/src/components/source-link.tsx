import { Github } from "lucide-react";
import { cn } from "@/lib/utils";

export const SOURCE_URL = "https://github.com/planetaryescape/marginalia";

/** Marginalia is open source; anyone may star, fork or read the code. */
export function SourceLink({ className }: { className?: string }) {
  return (
    <a
      href={SOURCE_URL}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex min-h-11 items-center gap-2 text-sm text-[var(--reader-muted)] hover:text-[var(--reader-fg)] underline-offset-4 hover:underline",
        className,
      )}
    >
      <Github size={16} aria-hidden />
      Marginalia is open source on GitHub
    </a>
  );
}
