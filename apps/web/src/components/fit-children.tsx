"use client";
import {
  Children,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Shows only the children that fit completely inside the available height, so
 * a no-scroll layout never displays a half-cut row. Children keep their order;
 * the ones that don't fit are hidden.
 */
export function FitChildren({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  /** Accessible name when the children form a list. */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(Number.POSITIVE_INFINITY);
  const items = Children.toArray(children);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the number of children changes
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const measure = () => {
      const limit = container.clientHeight;
      let count = 0;
      // Positioned container, so offsetTop is measured from its top edge
      for (const child of Array.from(container.children) as HTMLElement[]) {
        if (child.offsetTop + child.offsetHeight > limit + 1) break;
        count++;
      }
      setVisible(count);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [items.length]);

  return (
    <div
      ref={ref}
      {...(label ? { role: "list", "aria-label": label } : {})}
      className={cn("relative min-h-0 overflow-hidden", className)}
    >
      {items.map((child, i) => (
        <div
          // Children.toArray gives every child a stable key
          key={(child as { key?: string | null }).key ?? i}
          role={label ? "listitem" : undefined}
          aria-hidden={i < visible ? undefined : true}
          style={{ visibility: i < visible ? "visible" : "hidden" }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
