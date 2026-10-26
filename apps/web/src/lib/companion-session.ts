import { z } from "zod";

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

/** An unkept answer as it is held for the length of one visit to an article. */
const storedAnswerSchema = z.object({
  id: z.string(),
  mode: z.enum(["explain", "simplify", "define", "ask", "article"]),
  selection: z.string(),
  question: z.string().optional(),
  paragraphIndex: z.number().nullable(),
  turns: z.array(turnSchema).min(1),
  model: z.string().nullable(),
  occurrence: z.number().optional(),
  paragraphEnd: z.number().optional(),
  legacyId: z.string().optional(),
});

export type StoredAnswer = z.infer<typeof storedAnswerSchema>;

const keyFor = (articleId: string) => `marginalia:answers:${articleId}`;

function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    // Blocked storage (some private modes) throws on access
    return null;
  }
}

export function readAnswers(articleId: string): StoredAnswer[] {
  try {
    const raw = store()?.getItem(keyFor(articleId));
    const parsed = z.array(z.unknown()).safeParse(raw ? JSON.parse(raw) : []);
    if (!parsed.success) return [];
    // One damaged entry must not cost the reader the rest.
    return parsed.data.flatMap((entry) => {
      const answer = storedAnswerSchema.safeParse(entry);
      return answer.success ? [answer.data] : [];
    });
  } catch {
    return [];
  }
}

export function writeAnswers(articleId: string, answers: StoredAnswer[]) {
  try {
    if (answers.length)
      store()?.setItem(keyFor(articleId), JSON.stringify(answers));
    else store()?.removeItem(keyFor(articleId));
  } catch {
    // Over quota or blocked: the answer simply won't survive a refresh
  }
}

export function clearAnswers(articleId: string) {
  try {
    store()?.removeItem(keyFor(articleId));
  } catch {}
}

/**
 * Whether this page load is a refresh of the article itself. The document's
 * navigation entry says how the page was loaded and at what address, so an
 * answer left behind by leaving the article without React noticing (a typed
 * address, a hard link, Back after one) is never mistaken for a refresh.
 */
export function isRefreshOf(
  articleId: string,
  entry: Pick<PerformanceNavigationTiming, "type" | "name"> | undefined,
): boolean {
  if (entry?.type !== "reload") return false;
  // A book's answers are filed under "id:part"; the address holds only the id
  const [id] = articleId.split(":");
  try {
    return new URL(entry.name).pathname.replace(/\/$/, "") === `/read/${id}`;
  } catch {
    return false;
  }
}

export function restoreAnswers(articleId: string): StoredAnswer[] {
  if (typeof performance === "undefined") return [];
  // SAFETY: entries of type "navigation" are PerformanceNavigationTiming by definition.
  const entry = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (isRefreshOf(articleId, entry)) return readAnswers(articleId);
  clearAnswers(articleId);
  return [];
}

/**
 * Leaving the article clears its answers. The clear waits a tick so React's
 * development remount (cleanup, then setup again at once) cancels it.
 */
const pendingLeave = new Map<string, ReturnType<typeof setTimeout>>();

export function leaveArticle(articleId: string) {
  pendingLeave.set(
    articleId,
    setTimeout(() => {
      pendingLeave.delete(articleId);
      clearAnswers(articleId);
    }, 0),
  );
}

export function stayOnArticle(articleId: string) {
  const timer = pendingLeave.get(articleId);
  if (timer === undefined) return;
  clearTimeout(timer);
  pendingLeave.delete(articleId);
}
