/**
 * Titles the desk already holds, written when a pick is pressed. The reader
 * heading renders from here in the same commit as the navigation, so the
 * title morph has a destination to travel to; the article body loads after.
 * In memory only: a reload or a deep link has no desk row, and gets no morph.
 */
const titles = new Map<string, string>();

export function rememberTitle(articleId: string, title: string): void {
  titles.set(articleId, title);
}

export function rememberedTitle(articleId: string): string | undefined {
  return titles.get(articleId);
}

/** The shared name on the desk title and the reader heading. */
export function articleTitleName(articleId: string): string {
  return `article-title-${articleId}`;
}

/** How long after Done the desk still counts as "arriving from a finished article". */
const FINISH_ARRIVAL_MS = 5000;
let finishedAt = Number.NEGATIVE_INFINITY;

/** Called when Done turns the reader back to the desk. */
export function markFinished(now = Date.now()): void {
  finishedAt = now;
}

/**
 * Whether the desk just opened because an article was finished, so its slot
 * slides the next pick in. Time-bounded rather than read-once, so React's
 * double render of a mount reads the same answer.
 */
export function arrivedFromFinish(now = Date.now()): boolean {
  return now - finishedAt < FINISH_ARRIVAL_MS;
}
