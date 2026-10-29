/** How long our own scroll may take before we stop expecting its `scrollend`. */
const OWN_SCROLL_MS = 1000;

/** The reading line: 40% down the viewport, the line `useReadingPosition` uses. */
const READING_LINE = 0.4;
const TOP_MARGIN = 80;

export interface Follower {
  /** Begins a listen: following again, and watching for the reader's own scrolls. */
  start(): void;
  /** Ends a listen: stops watching, and forgets which block was last shown. */
  stop(): void;
  /** Brings `el` into view if the page is following and it sits outside the band, at most once per element. */
  reveal(el: HTMLElement): void;
  /** Scrolls `el` to the reading line and follows again. */
  follow(el: HTMLElement | undefined): void;
  readonly following: boolean;
  /** Whether a listen is being watched, so a skip within it doesn't start over. */
  readonly active: boolean;
}

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** The lowest y the voice's block may reach: the top of the Listen pill, else a margin off the bottom. */
function bandBottom() {
  const pill = document.querySelector(".listen-pill");
  const top = pill?.getBoundingClientRect().top;
  return top && top > 0 ? top : window.innerHeight - TOP_MARGIN;
}

/**
 * D-TTS-012: the page follows the voice until the reader scrolls. The follower
 * marks the scrolls it makes itself, so that any other scroll (wheel, touch,
 * keyboard, scrollbar, `j`/`k`) can be told apart and ends following.
 * `onChange` hears every change of `following`.
 */
export function createFollower(onChange: () => void): Follower {
  let following = true;
  let watching = false;
  let own = false;
  let ownTimer: ReturnType<typeof setTimeout> | undefined;
  let shown: HTMLElement | null = null;

  const release = () => {
    if (!following) return;
    following = false;
    onChange();
  };
  // Wheel and touch are always the reader's, even in the middle of our own smooth scroll
  const onScroll = () => {
    if (!own) release();
  };
  const onScrollEnd = () => {
    own = false;
    clearTimeout(ownTimer);
  };

  function scrollTo(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const line = window.innerHeight * READING_LINE;
    // A block that fits is centred on the reading line; a taller one starts below the header
    const height = rect.height;
    const target =
      height <= (window.innerHeight - TOP_MARGIN) * 0.6
        ? rect.top + height / 2 - line
        : rect.top - TOP_MARGIN - 16;
    if (Math.abs(target) < 1) return;
    own = true;
    clearTimeout(ownTimer);
    // `scrollend` isn't everywhere, and doesn't fire when nothing moved
    ownTimer = setTimeout(() => {
      own = false;
    }, OWN_SCROLL_MS);
    window.scrollTo({
      top: Math.max(0, window.scrollY + target),
      behavior: reducedMotion() ? "instant" : "smooth",
    });
  }

  return {
    get following() {
      return following;
    },
    get active() {
      return watching;
    },
    start() {
      this.stop();
      // The caller publishes its own state right after starting, so no onChange here
      following = true;
      watching = true;
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("scrollend", onScrollEnd);
      window.addEventListener("wheel", release, { passive: true });
      window.addEventListener("touchmove", release, { passive: true });
    },
    stop() {
      if (!watching) return;
      watching = false;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      clearTimeout(ownTimer);
      own = false;
      shown = null;
    },
    reveal(el) {
      if (!following || shown === el) return;
      shown = el;
      const rect = el.getBoundingClientRect();
      if (rect.top < TOP_MARGIN || rect.bottom > bandBottom()) scrollTo(el);
    },
    follow(el) {
      const was = following;
      following = true;
      if (el) {
        shown = el;
        scrollTo(el);
      }
      if (!was) onChange();
    },
  };
}
