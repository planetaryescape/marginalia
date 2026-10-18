import { annotationBudget } from "./annotationGate";

/**
 * Current notes are 2–4 substantive sentences, not the retired short labels.
 * Allow 800 tokens per candidate for prose, verbatim anchor, reasoning, optional
 * reference/excerpt and JSON; another 2,000 covers thesis/gist/tags/reflection.
 * At the current 40-note cap this is 34,000, independently for each parse retry.
 * ChatGPT plan calls deliberately do not send an output-cap parameter.
 */
export function annotationOutputTokens(wordCount: number): number {
  return 2_000 + 800 * annotationBudget(wordCount).cap;
}
