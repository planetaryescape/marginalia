import { Github } from "lucide-react";
import { cn } from "@/lib/utils";

export const SOURCE_URL = "https://github.com/planetaryescape/marginalia";

/** Marginalia is open source; anyone may star, fork or read the code. */
export function SourceLink({
  variant = "icon",
  className,
}: {
  variant?: "icon" | "text" | "menu";
  className?: string;
}) {
  if (variant === "text")
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
  if (variant === "menu")
    return (
      <a
        href={SOURCE_URL}
        target="_blank"
        rel="noreferrer"
        className={cn("mobile-menu-action gap-2", className)}
      >
        <Github size={16} aria-hidden />
        Source on GitHub
      </a>
    );
  return (
    <a
      href={SOURCE_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Marginalia source on GitHub"
      title="Source on GitHub: star or fork it"
      className={cn(
        "w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-lg text-[var(--reader-muted)] hover:text-[var(--reader-fg)]",
        className,
      )}
    >
      <Github size={18} aria-hidden />
    </a>
  );
}
