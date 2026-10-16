import type { Id } from "@marginalia/backend/convex/_generated/dataModel";

// The longest window the suggestion queries accept
const MAX_WINDOW_MINUTES = 180;

export function parseWindowMinutes(value: string | null): number | undefined {
  if (value === null) return undefined;
  const minutes = Number(value);
  return Number.isFinite(minutes) &&
    minutes > 0 &&
    minutes <= MAX_WINDOW_MINUTES
    ? minutes
    : undefined;
}

export type DeskLink = { minutes: number; sessionId?: Id<"sessions"> };

/** The desk in its chosen state, as a URL. Old `/session/[id]` links redirect here. */
export function deskLinkHref(link: DeskLink): string {
  const params = new URLSearchParams({ m: String(link.minutes) });
  if (link.sessionId) params.set("session", link.sessionId);
  return `/?${params}`;
}

export function parseDeskLink(params: {
  get(name: string): string | null;
}): DeskLink | null {
  const minutes = parseWindowMinutes(params.get("m"));
  if (minutes === undefined) return null;
  const session = params.get("session");
  // SAFETY: the id only ever came from a link this app wrote; Convex validates it again on use.
  return session
    ? { minutes, sessionId: session as Id<"sessions"> }
    : { minutes };
}
