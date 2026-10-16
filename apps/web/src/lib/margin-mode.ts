export type MarginMode = "sidenotes" | "phone" | "sheet";

/** Matches the `sm` breakpoint the notes pane and bottom bar already use. */
export const PHONE_MAX_WIDTH = 639;
/** Gutter width the right margin needs to show sidenotes. */
export const MIN_GUTTER = 300;

/**
 * Where margin notes live: beside their line when the right gutter is wide
 * enough, under their paragraph on a phone, and in a card or sheet between.
 */
export function marginModeFor(innerWidth: number, gutter: number): MarginMode {
  if (innerWidth <= PHONE_MAX_WIDTH) return "phone";
  return gutter >= MIN_GUTTER ? "sidenotes" : "sheet";
}

/** Space right of the article that the docked notes pane doesn't cover. */
export function measureGutter(article: HTMLElement): number {
  const notesInset =
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--notes-inset",
      ),
    ) || 0;
  return window.innerWidth - notesInset - article.getBoundingClientRect().right;
}
