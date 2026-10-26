// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revealImpression, WASH_MS } from "./reader-impression";

let section: HTMLElement;
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<section aria-label="Your impression"><fieldset><input type="radio" name="r" /></fieldset><button>Done</button></section>`;
  section = document.querySelector("section") as HTMLElement;
  scrollIntoView = vi.fn();
  section.scrollIntoView =
    scrollIntoView as unknown as typeof section.scrollIntoView;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("revealImpression", () => {
  it("scrolls smoothly, focuses the first control and washes for 600ms", () => {
    const timer = revealImpression(section, false, null);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "smooth",
    });
    expect(document.activeElement?.getAttribute("type")).toBe("radio");
    expect(section.classList.contains("impression-wash")).toBe(true);
    expect(timer).not.toBeNull();
    vi.advanceTimersByTime(WASH_MS - 1);
    expect(section.classList.contains("impression-wash")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(section.classList.contains("impression-wash")).toBe(false);
  });

  it("uses an instant scroll and no wash under reduced motion", () => {
    const timer = revealImpression(section, true, null);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "instant",
    });
    expect(document.activeElement?.getAttribute("type")).toBe("radio");
    expect(section.classList.contains("impression-wash")).toBe(false);
    expect(timer).toBeNull();
  });

  it("restarts the wash on a repeat press instead of stacking timers", () => {
    const first = revealImpression(section, false, null);
    vi.advanceTimersByTime(300);
    const second = revealImpression(section, false, first);
    vi.advanceTimersByTime(WASH_MS - 1);
    // The first timer was cleared, so the wash still runs its full length from the second press
    expect(section.classList.contains("impression-wash")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(section.classList.contains("impression-wash")).toBe(false);
    expect(second).not.toBeNull();
  });
});
