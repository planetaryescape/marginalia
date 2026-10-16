/** Matches --motion-sweep: one linear 180 ms pass over the whole passage. */
export const SWEEP_MS = 180;

/**
 * Paints the new highlight left to right, line by line in proportion to each
 * line's length. The saved mark itself is a CSS custom highlight, which can't
 * be animated, so this draws throwaway bars in the same colour above it and
 * removes them once the pass ends. Reduced motion draws nothing: the saved
 * mark and its tick simply appear.
 */
export function sweepHighlight(range: Range): void {
  if (
    typeof window === "undefined" ||
    typeof Element.prototype.animate !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;
  const lines = [...range.getClientRects()].filter(
    (r) => r.width > 1 && r.height > 1,
  );
  const total = lines.reduce((sum, r) => sum + r.width, 0);
  if (!total) return;

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:30;overflow:hidden";
  let done = 0;
  const animations = lines.map((r) => {
    const bar = document.createElement("div");
    bar.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:var(--highlighter);border-radius:2px;transform-origin:0 50%;transform:scaleX(0)`;
    layer.appendChild(bar);
    const animation = bar.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      {
        delay: (SWEEP_MS * done) / total,
        duration: (SWEEP_MS * r.width) / total,
        easing: "linear",
        fill: "both",
      },
    );
    done += r.width;
    return animation;
  });
  document.body.appendChild(layer);
  // The saved mark paints under these bars; drop them once it has had time to.
  void Promise.all(animations.map((a) => a.finished))
    .catch(() => {})
    .finally(() => window.setTimeout(() => layer.remove(), 120));
}
