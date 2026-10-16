import type { CompanionMode, CompanionTurn } from "./companion";

/** An unkept answer as it is held for the length of one visit to an article. */
export interface StoredAnswer {
  id: string;
  mode: CompanionMode;
  selection: string;
  question?: string;
  paragraphIndex: number | null;
  turns: CompanionTurn[];
  model: string | null;
}

const MODES: readonly string[] = [
  "explain",
  "simplify",
  "define",
  "ask",
  "article",
];

const keyFor = (articleId: string) => `marginalia:answers:${articleId}`;

function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    // Blocked storage (some private modes) throws on access
    return null;
  }
}

function isTurn(value: unknown): value is CompanionTurn {
  if (typeof value !== "object" || value === null) return false;
  const turn = value as Record<string, unknown>;
  return (
    (turn.role === "user" || turn.role === "assistant") &&
    typeof turn.content === "string"
  );
}

function isStored(value: unknown): value is StoredAnswer {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    typeof a.mode === "string" &&
    MODES.includes(a.mode) &&
    typeof a.selection === "string" &&
    (a.question === undefined || typeof a.question === "string") &&
    (a.paragraphIndex === null || typeof a.paragraphIndex === "number") &&
    Array.isArray(a.turns) &&
    a.turns.length > 0 &&
    a.turns.every(isTurn) &&
    (a.model === null || typeof a.model === "string")
  );
}

export function readAnswers(articleId: string): StoredAnswer[] {
  try {
    const raw = store()?.getItem(keyFor(articleId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isStored) : [];
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
  try {
    return (
      new URL(entry.name).pathname.replace(/\/$/, "") === `/read/${articleId}`
    );
  } catch {
    return false;
  }
}

export function restoreAnswers(articleId: string): StoredAnswer[] {
  if (typeof performance === "undefined") return [];
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
