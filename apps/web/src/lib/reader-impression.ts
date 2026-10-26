const WASH_CLASS = "impression-wash";
export const WASH_MS = 600;

/**
 * Brings the back matter's impression into view and puts focus on its first
 * control. Returns the timer that removes the wash, so the caller can cancel it.
 * Reduced motion gets an instant scroll and no wash.
 */
export function revealImpression(
  section: HTMLElement,
  reducedMotion: boolean,
  previousTimer: number | null,
): number | null {
  section.scrollIntoView({
    block: "center",
    behavior: reducedMotion ? "instant" : "smooth",
  });
  section
    .querySelector<HTMLElement>("input, button, textarea")
    ?.focus({ preventScroll: true });
  if (reducedMotion) return null;
  if (previousTimer !== null) window.clearTimeout(previousTimer);
  // Remove and re-add so a repeat press restarts the animation.
  section.classList.remove(WASH_CLASS);
  void section.offsetWidth;
  section.classList.add(WASH_CLASS);
  return window.setTimeout(() => section.classList.remove(WASH_CLASS), WASH_MS);
}
