"use client";
import { useAltHint } from "@/lib/use-alt-hint";
import { cn } from "@/lib/utils";

/**
 * The key for a control, shown only while the reader holds Alt (D-DES-030), so
 * the interface carries no permanent key labels. Decorative: the control
 * names its key through aria-keyshortcuts.
 */
export function Keycap({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  if (!useAltHint()) return null;
  return (
    <kbd aria-hidden className={cn("reader-kbd text-[11px]", className)}>
      {children}
    </kbd>
  );
}
