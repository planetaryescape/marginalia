/** How long the player's own scroll may take before we stop waiting for its `scrollend`. */
const OWN_SCROLL_MS = 1000;
/** Quiet time after the last frame of the player's scroll before it counts as finished, where `scrollend` isn't supported. */
const SETTLE_MS = 150;
/** Pixels of slack around the player's scroll path, for rounding and sub-pixel layout. */
const TOLERANCE = 2;

/** The reading line: 40% down the viewport, the line `useReadingPosition` uses. */
const READING_LINE = 0.4;
/** Clearance used where the page has no toolbar or bar to measure. */
const FALLBACK_MARGIN = 80;
const GAP = 8;

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

/**
 * The space the voice's block should sit in: below the fixed toolbar (its real
 * bottom edge, which includes the top safe-area inset) and above whichever of
 * the Listen pill and the phone's bottom bar is highest.
 */
function clearance() {
  const toolbar = document
    .querySelector(".reader-toolbar")
    ?.getBoundingClientRect();
  const top =
    toolbar && toolbar.bottom > 0
      ? Math.max(toolbar.bottom + GAP, FALLBACK_MARGIN)
      : FALLBACK_MARGIN;
  const lids = [".listen-pill", ".mobile-reader-bar"]
    .map((selector) =>
      document.querySelector(selector)?.getBoundingClientRect(),
    )
    .filter((rect): rect is DOMRect => Boolean(rect && rect.height > 0))
    .map((rect) => rect.top)
    .filter((y) => y > 0);
  const bottom = lids.length
    ? Math.min(...lids) - GAP
    : window.innerHeight - FALLBACK_MARGIN;
  return { top, bottom };
}

/** The furthest the document can scroll; unmeasured (no layout) means unlimited. */
function maxScroll() {
  const root = document.documentElement;
  return root.scrollHeight > 0
    ? Math.max(0, root.scrollHeight - (root.clientHeight || window.innerHeight))
    : Number.POSITIVE_INFINITY;
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
  /**
   * The player's scroll in flight: the span of positions it may legitimately
   * pass through, and whether it has reached its target (after which it can only
   * stay there).
   */
  let flight: {
    lo: number;
    hi: number;
    target: number;
    arrived: boolean;
  } | null = null;
  let flightTimer: ReturnType<typeof setTimeout> | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let shown: HTMLElement | null = null;

  const release = () => {
    if (!following) return;
    following = false;
    onChange();
  };
  const land = () => {
    flight = null;
    clearTimeout(flightTimer);
    clearTimeout(settleTimer);
  };
  const onScroll = () => {
    if (!flight) {
      release();
      return;
    }
    const y = window.scrollY;
    const atTarget = Math.abs(y - flight.target) <= TOLERANCE;
    // Off the path, or moving away from a target it had already reached: the reader
    if (
      y < flight.lo - TOLERANCE ||
      y > flight.hi + TOLERANCE ||
      (flight.arrived && !atTarget)
    ) {
      land();
      release();
      return;
    }
    if (atTarget) flight.arrived = true;
    // A smooth scroll keeps producing frames until it is done, so the player
    // keeps ownership until the page has been still for a moment (or `scrollend`)
    clearTimeout(settleTimer);
    settleTimer = setTimeout(land, SETTLE_MS);
  };

  function scrollTo(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const { top, bottom } = clearance();
    const height = rect.height;
    const line = window.innerHeight * READING_LINE;
    // A block that fits is centred on the reading line, kept between the
    // toolbar and the bars; a taller one starts just below the toolbar
    const fits = height <= (bottom - top) * 0.6;
    const wanted = fits
      ? Math.max(top, Math.min(line - height / 2, bottom - height))
      : top;
    const start = window.scrollY;
    // The browser clamps at the ends of the document; arming for a position it
    // can't reach would swallow the reader's scrolls when `scrollend` never comes
    const target = Math.min(
      maxScroll(),
      Math.max(0, start + rect.top - wanted),
    );
    if (Math.abs(target - start) < 1) return;
    flight = {
      lo: Math.min(start, target),
      hi: Math.max(start, target),
      target,
      arrived: false,
    };
    clearTimeout(flightTimer);
    clearTimeout(settleTimer);
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
      const { top, bottom } = clearance();
      if (rect.top < top || rect.bottom > bottom) scrollTo(el);
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
