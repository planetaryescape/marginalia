"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useAction } from "convex/react";
import { useMemo } from "react";
import type { ClipSource } from "./use-natural-voice";

type SpeechClip = (args: {
  articleId: Id<"articles">;
  text: string;
}) => Promise<ArrayBuffer>;

/**
 * Turns the speech action into the player's clip source: the action returns
 * the MP3 as bytes, which become a Blob the audio element can play. Errors pass
 * through as the action's own ConvexError, for `failureSentence` to read.
 */
export function speechClipSource(
  clip: SpeechClip,
  articleId: Id<"articles">,
): ClipSource {
  // Convex actions can't be cancelled, so the signal is left to the player,
  // which ignores a result that arrives after Stop
  return async (text) =>
    new Blob([await clip({ articleId, text })], { type: "audio/mpeg" });
}

/** The clip source for an article; a book's parts use the book's own id. */
export function useSpeechClip(articleId: Id<"articles">): ClipSource {
  const clip = useAction(api.speech.clip);
  return useMemo(() => speechClipSource(clip, articleId), [clip, articleId]);
}
