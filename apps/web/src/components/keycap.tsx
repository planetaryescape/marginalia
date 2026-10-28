"use client";
import { useAltHint } from "@/lib/use-alt-hint";
import { cn } from "@/lib/utils";

/**
 * The key for a control, shown only while the reader holds Alt (D-DES-030), so
 * the interface carries no permanent key labels. `force` shows it for a surface
 * the reader opened from the keyboard. Decorative: the control
 * names its key through aria-keyshortcuts.
 */
export function Keycap({
  children,
  className,
  force = false,
}: {
  children: string;
  className?: string;
  /** Show without Alt, for a control the reader reached by keyboard (D-DES-021 shows keys on demand). */
  force?: boolean;
}) {
  const held = useAltHint();
  if (!held && !force) return null;
  return (
    <kbd aria-hidden className={cn("reader-kbd text-[11px]", className)}>
      {children}
    </kbd>
  );
}
