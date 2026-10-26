import { ConvexError } from "convex/values";

/**
 * The sentences that several surfaces share when the same failure happens, so
 * a reader sees one wording wherever they acted. Server sentences that name a
 * provider or a limit stay on the server and arrive through `failureSentence`.
 */
export const FAILURE_COPY = {
  unreachable:
    "Couldn't reach Marginalia. Check your connection and try again.",
  save: "Couldn't save. Try again.",
} as const;

/**
 * The server's own sentence when it sent one, otherwise the shared fallback. A
 * plain Error has no sentence for the reader: it is a network or transport
 * failure, so it gets the fallback instead of its raw message.
 */
export function failureSentence(error: unknown, fallback: string): string {
  if (error instanceof ConvexError && typeof error.data === "string")
    return error.data;
  return fallback;
}
