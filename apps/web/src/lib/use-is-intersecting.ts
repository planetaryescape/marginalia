"use client";
import { useEffect, useState } from "react";

/** True while any part of the element is inside the viewport. */
export function useIsIntersecting(element: Element | null) {
  const [intersecting, setIntersecting] = useState(false);
  useEffect(() => {
    if (!element) {
      setIntersecting(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setIntersecting(entry.isIntersecting),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return intersecting;
}
