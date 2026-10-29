/** How long the player's own scroll may take before we stop waiting for its `scrollend`. */
const OWN_SCROLL_MS = 1000;
/** Pixels of slack around the player's scroll path, for rounding and sub-pixel layout. */
const TOLERANCE = 2;

/** The reading line: 40% down the viewport, the line `useReadingPosition` uses. */
const READING_LINE = 0.4;
const TOP_MARGIN = 80;

export interface Follower {
  /** Begins a listen: following again, and watching the page's scroll. */
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
 * D-TTS-012, D-TTS-029: the page follows the voice until it moves somewhere the
 * voice didn't send it. Only scrolls of the document are watched (a contained
 * scroller such as the settings panel doesn't raise them on `window`), and the
 * follower decides from where the page is, never from which key or gesture
 * moved it. While the player's own scroll is in flight, any position between
 * where it started and where it is headed is the player's; any other position,
 * or any scroll once it has landed, is the reader's. `onChange` hears every
 * change of `following`.
 */
export function createFollower(onChange: () => void): Follower {
  let following = true;
  let watching = false;
  /** The player's scroll in flight: the span of positions it may legitimately pass through. */
  let flight: { lo: number; hi: number; target: number } | null = null;
  let flightTimer: ReturnType<typeof setTimeout> | undefined;
  let shown: HTMLElement | null = null;

  const release = () => {
    if (!following) return;
    following = false;
    onChange();
  };
  const land = () => {
    flight = null;
    clearTimeout(flightTimer);
  };
  const onScroll = () => {
    if (!flight) {
      release();
      return;
    }
    const y = window.scrollY;
    if (y < flight.lo - TOLERANCE || y > flight.hi + TOLERANCE) {
      land();
      release();
    } else if (Math.abs(y - flight.target) <= TOLERANCE) land();
  };

  function scrollTo(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const line = window.innerHeight * READING_LINE;
    // A block that fits is centred on the reading line; a taller one starts below the header
    const height = rect.height;
    const delta =
      height <= (window.innerHeight - TOP_MARGIN) * 0.6
        ? rect.top + height / 2 - line
        : rect.top - TOP_MARGIN - 16;
    const start = window.scrollY;
    const target = Math.max(0, start + delta);
    if (Math.abs(target - start) < 1) return;
    flight = {
      lo: Math.min(start, target),
      hi: Math.max(start, target),
      target,
    };
    clearTimeout(flightTimer);
    // `scrollend` isn't everywhere, and the position may never land exactly
    flightTimer = setTimeout(land, OWN_SCROLL_MS);
    window.scrollTo({
      top: target,
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
      window.addEventListener("scrollend", land);
    },
    stop() {
      if (!watching) return;
      watching = false;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", land);
      land();
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
