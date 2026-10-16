/**
 * Where the reader's Back goes, and where each room was scrolled to.
 *
 * Kept in memory for this page load only: a reload or a direct link starts
 * cold and returns to Desk, and another tab never sees this tab's rooms.
 * sessionStorage would survive a reload and point Back at a room the reader
 * no longer came from.
 */

const READER_PATH = /^\/read\//;

export interface BackTarget {
  label: "Desk" | "Library" | "Notes";
  href: string;
}

const DESK: BackTarget = { label: "Desk", href: "/" };

let origin: string | null = null;
const roomScroll = new Map<string, number>();

export function isReaderPath(pathname: string): boolean {
  return READER_PATH.test(pathname);
}

/** Called for each room the reader navigates to; reader paths are never an origin. */
export function recordRoom(pathname: string): void {
  if (!isReaderPath(pathname)) origin = pathname;
}

export function originRoom(): string | null {
  return origin;
}

/**
 * Back target for an origin room. Anything that is not Library or Notes, or a
 * room the reader never came from, falls back to Desk. An article opened from
 * a session keeps returning to that session.
 */
export function backTarget(
  originPath: string | null,
  sessionId: string | null,
): BackTarget {
  if (originPath === "/library") return { label: "Library", href: "/library" };
  if (originPath === "/notes") return { label: "Notes", href: "/notes" };
  if (originPath?.startsWith("/session/")) {
    return { label: "Desk", href: originPath };
  }
  if (sessionId) return { label: "Desk", href: `/session/${sessionId}` };
  return DESK;
}

export function rememberScroll(room: string, y: number): void {
  roomScroll.set(room, y);
}

export function savedScroll(room: string): number | undefined {
  return roomScroll.get(room);
}

/**
 * Whether the room is tall enough to scroll to `target` yet. Data loads after
 * the room renders, so an earlier scroll would clamp to the short page.
 */
export function canReach(
  target: number,
  scrollHeight: number,
  viewportHeight: number,
): boolean {
  return scrollHeight - viewportHeight >= target;
}
