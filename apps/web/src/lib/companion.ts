"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  leaveArticle,
  restoreAnswers,
  type StoredAnswer,
  stayOnArticle,
  writeAnswers,
} from "./companion-session";
import { senseOf, sentenceAround } from "./lookups";
import {
  getArticleBody,
  getParagraphs,
  paragraphIndexOf,
  paragraphText,
} from "./paragraphs";
import { type ReaderSettings, webSearchEnabled } from "./reader-settings";

/** "article" is a question about the whole piece, with no highlighted passage. */
export type CompanionMode =
  | "explain"
  | "simplify"
  | "define"
  | "ask"
  | "article";

export interface CompanionTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CompanionThread {
  /** Local identity for the answer; stays the same once it is kept. */
  id: string;
  /** The saved record, once the reader has kept the answer. */
  savedId?: Id<"companionThreads">;
  mode: CompanionMode;
  selection: string;
  question?: string;
  paragraphIndex: number | null;
  turns: CompanionTurn[];
  status: "streaming" | "done" | "error";
  error?: string;
  model?: string | null;
  /** Keep has been pressed and the record is being written. */
  keeping?: boolean;
}

/** A request the backend refused with a reason the reader can act on. */
export class ReaderRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** The backend's reason for a failed request, e.g. a missing provider key. */
export async function readerRequestError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: unknown; code?: unknown };
    if (typeof body.error === "string")
      return new ReaderRequestError(
        body.error,
        typeof body.code === "string" ? body.code : undefined,
      );
  } catch {}
  return new ReaderRequestError(text || `Request failed (${res.status})`);
}

/** Streams a plain-text answer from one of the Convex HTTP endpoints. */
export async function streamFromConvex(
  path: "/api/companion" | "/api/library",
  body: Record<string, unknown>,
  handlers: {
    signal: AbortSignal;
    onModel: (model: string | null) => void;
    onText: (chunk: string) => void;
  },
) {
  const res = await fetch(`/api/reader/${path.replace(/^\/api\//, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });
  if (!res.ok || !res.body) throw await readerRequestError(res);
  handlers.onModel(res.headers.get("X-Companion-Model"));
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      handlers.onText(value);
    }
  } finally {
    reader.releaseLock();
  }
}

/** Only a finished, unkept answer is held for a refresh. */
const holdsForRefresh = (a: CompanionThread) =>
  a.status === "done" && !a.savedId && a.turns.length > 0;

const toStored = (a: CompanionThread): StoredAnswer => ({
  id: a.id,
  mode: a.mode,
  selection: a.selection,
  question: a.question,
  paragraphIndex: a.paragraphIndex,
  turns: a.turns,
  model: a.model ?? null,
});

const fromStored = (a: StoredAnswer): CompanionThread => ({
  ...a,
  status: "done",
});

const fromDoc = (doc: Doc<"companionThreads">): CompanionThread => ({
  id: doc._id,
  savedId: doc._id,
  mode: doc.mode,
  selection: doc.selection,
  question: doc.question,
  paragraphIndex: doc.paragraphIndex ?? null,
  turns: doc.turns,
  status: "done",
  model: doc.model ?? null,
});

/**
 * The answers of one visit to an article. They are temporary (D-DES-045): held
 * in this tab's session storage so a refresh keeps them, cleared when the
 * reader leaves the article, and written to the server only by `keep`.
 */
export function useCompanion({
  articleId,
  containerRef,
  title,
  settings,
}: {
  articleId: Id<"articles">;
  containerRef: React.RefObject<HTMLElement | null>;
  title: string;
  settings: ReaderSettings;
}) {
  // The ref is the truth; the state mirrors it for rendering. Handlers read
  // the ref, so a quick second action never acts on a stale render.
  const answersRef = useRef<CompanionThread[]>([]);
  const [answers, setAnswersState] = useState<CompanionThread[]>([]);
  const [openId, setOpenState] = useState<string | null>(null);
  const openIdRef = useRef<string | null>(null);
  const setOpenId = useCallback((next: string | null) => {
    openIdRef.current = next;
    setOpenState(next);
  }, []);
  const controllers = useRef(new Map<string, AbortController>());
  // The article whose answers may be written to session storage; null once left.
  const live = useRef<string | null>(null);
  const latest = useRef({ title, settings });
  useEffect(() => {
    latest.current = { title, settings };
  });

  const keepThread = useMutation(api.companionThreads.keep);
  const updateTurns = useMutation(api.companionThreads.updateTurns);
  const removeThread = useMutation(api.companionThreads.remove);
  const recordLookup = useMutation(api.lookups.record);

  const set = useCallback((next: CompanionThread[], save = false) => {
    answersRef.current = next;
    setAnswersState(next);
    if (save && live.current)
      writeAnswers(live.current, next.filter(holdsForRefresh).map(toStored));
  }, []);
  const patch = useCallback(
    (
      id: string,
      change: (t: CompanionThread) => CompanionThread,
      save = false,
    ) =>
      set(
        answersRef.current.map((a) => (a.id === id ? change(a) : a)),
        save,
      ),
    [set],
  );

  // Arriving on an article restores a refresh's answers; leaving it clears them.
  // Cleanup does not run on a refresh, so a refresh never clears.
  useEffect(() => {
    live.current = articleId;
    stayOnArticle(articleId);
    set(restoreAnswers(articleId).map(fromStored));
    setOpenId(null);
    const running = controllers.current;
    return () => {
      live.current = null;
      leaveArticle(articleId);
      for (const controller of running.values()) controller.abort();
      running.clear();
    };
  }, [articleId, set, setOpenId]);

  const run = useCallback(
    async (base: CompanionThread, history: CompanionTurn[]) => {
      controllers.current.get(base.id)?.abort();
      const controller = new AbortController();
      controllers.current.set(base.id, controller);

      const streaming: CompanionThread = {
        ...base,
        turns: [...history, { role: "assistant", content: "" }],
        status: "streaming",
        error: undefined,
      };
      set(
        answersRef.current.some((a) => a.id === base.id)
          ? answersRef.current.map((a) => (a.id === base.id ? streaming : a))
          : [...answersRef.current, streaming],
      );
      setOpenId(base.id);

      const { title, settings } = latest.current;
      const paragraphs = getParagraphs(
        getArticleBody(containerRef.current),
      ).map(paragraphText);

      let answer = "";
      let model: string | null = base.model ?? null;
      try {
        await streamFromConvex(
          "/api/companion",
          {
            mode: base.mode,
            articleId,
            title,
            paragraphs,
            selection: base.selection,
            paragraphIndex: base.paragraphIndex,
            question: base.question,
            history,
            length: settings.answerLength,
            level: settings.answerLevel,
            depth: settings.answerDepth,
            web: webSearchEnabled(settings),
          },
          {
            signal: controller.signal,
            onModel: (m) => {
              model = m;
              patch(base.id, (t) => ({ ...t, model: m }));
            },
            onText: (chunk) => {
              answer += chunk;
              patch(base.id, (t) => {
                const turns = t.turns.slice();
                turns[turns.length - 1] = {
                  role: "assistant",
                  content: answer,
                };
                return { ...t, turns };
              });
            },
          },
        );
        if (!answer.trim()) throw new Error("No answer came back. Try again.");
      } catch (error) {
        if (controller.signal.aborted) return;
        patch(base.id, (t) => ({
          ...t,
          status: "error",
          error:
            error instanceof Error && error.message
              ? error.message
              : "Something went wrong.",
        }));
        return;
      }

      const turns = [
        ...history,
        { role: "assistant" as const, content: answer },
      ];
      patch(base.id, (t) => ({ ...t, turns, model, status: "done" }), true);

      // A kept answer is the reader's record, so its follow-ups join it.
      const savedId = answersRef.current.find((a) => a.id === base.id)?.savedId;
      if (savedId)
        updateTurns({
          threadId: savedId,
          turns,
          model: model ?? undefined,
        }).catch(() => toast.error("Couldn't update the kept answer"));

      // The lookup log keeps every completed Define, kept or not (D-DES-058).
      // Follow-ups are not new lookups, and Regenerate repeats the same one.
      if (base.mode === "define" && history.length === 0)
        recordLookup({
          articleId,
          word: base.selection,
          sentence: sentenceAround(
            base.paragraphIndex === null
              ? ""
              : (paragraphs[base.paragraphIndex] ?? ""),
            base.selection,
          ),
          paragraphIndex: base.paragraphIndex ?? undefined,
          sense: senseOf(answer),
        }).catch((error) => console.error("Couldn't log the lookup", error));
    },
    [articleId, containerRef, patch, recordLookup, set, setOpenId, updateTurns],
  );

  const start = useCallback(
    (args: { mode: CompanionMode; range: Range; question?: string }) => {
      const selection = args.range.toString().replace(/\s+/g, " ").trim();
      if (!selection) return;
      run(
        {
          id: crypto.randomUUID(),
          mode: args.mode,
          selection,
          question: args.question,
          paragraphIndex: paragraphIndexOf(args.range.startContainer),
          turns: [],
          status: "streaming",
        },
        [],
      );
    },
    [run],
  );

  const startArticle = useCallback(
    (question: string) => {
      if (!question.trim()) return;
      run(
        {
          id: crypto.randomUUID(),
          mode: "article",
          selection: "",
          question: question.trim(),
          paragraphIndex: null,
          turns: [],
          status: "streaming",
        },
        [],
      );
    },
    [run],
  );

  /** Opens an answer already in this visit. */
  const openAnswer = useCallback((id: string) => setOpenId(id), [setOpenId]);

  /** Opens a kept answer without calling the model again. */
  const open = useCallback(
    (doc: Doc<"companionThreads">) => {
      const existing = answersRef.current.find(
        (a) => a.id === doc._id || a.savedId === doc._id,
      );
      if (existing) {
        setOpenId(existing.id);
        return;
      }
      set([...answersRef.current, fromDoc(doc)]);
      setOpenId(doc._id);
    },
    [set, setOpenId],
  );

  const openThread = useCallback(
    () => answersRef.current.find((a) => a.id === openIdRef.current),
    [],
  );

  const followUp = useCallback(
    (question: string) => {
      const current = openThread();
      if (
        !current ||
        current.status === "streaming" ||
        current.keeping ||
        !question.trim()
      )
        return;
      run(current, [
        ...current.turns,
        { role: "user", content: question.trim() },
      ]);
    },
    [openThread, run],
  );

  const regenerate = useCallback(() => {
    const current = openThread();
    if (!current || current.keeping) return;
    const history =
      current.turns[current.turns.length - 1]?.role === "assistant"
        ? current.turns.slice(0, -1)
        : current.turns;
    run(current, history);
  }, [openThread, run]);

  /** Keeps an answer: the one place a new reader writes a thread. */
  const keep = useCallback(
    async (id: string): Promise<boolean> => {
      const current = answersRef.current.find((a) => a.id === id);
      // One Keep at a time per answer, and only for a finished, unkept answer.
      if (
        !current ||
        current.savedId ||
        current.keeping ||
        current.status !== "done"
      )
        return false;
      patch(id, (t) => ({ ...t, keeping: true }));
      try {
        const savedId = await keepThread({
          articleId,
          mode: current.mode,
          selection: current.selection,
          question: current.question,
          paragraphIndex: current.paragraphIndex ?? undefined,
          turns: current.turns,
          model: current.model ?? undefined,
        });
        // Saving it drops it from session storage: the record is now the copy.
        patch(id, (t) => ({ ...t, savedId, keeping: false }), true);
        return true;
      } catch {
        patch(id, (t) => ({ ...t, keeping: false }));
        return false;
      }
    },
    [articleId, keepThread, patch],
  );

  /** Folds the open answer back into the margin; it stays for the visit. */
  const collapse = useCallback(() => setOpenId(null), [setOpenId]);

  const remove = useCallback(
    async (id: string) => {
      const current = answersRef.current.find((a) => a.id === id);
      controllers.current.get(id)?.abort();
      controllers.current.delete(id);
      set(
        answersRef.current.filter((a) => a.id !== id),
        true,
      );
      if (openIdRef.current === id) setOpenId(null);
      if (current?.savedId) await removeThread({ threadId: current.savedId });
    },
    [removeThread, set, setOpenId],
  );

  return {
    answers,
    openId,
    thread: answers.find((a) => a.id === openId) ?? null,
    start,
    startArticle,
    open,
    openAnswer,
    collapse,
    followUp,
    regenerate,
    keep,
    remove,
  };
}

/** Tints a range with the CSS Custom Highlight API, so the article DOM is never mutated. */
export function usePassageHighlight(name: string, range: Range | null) {
  useEffect(() => {
    if (!range || typeof CSS === "undefined" || !("highlights" in CSS)) return;
    CSS.highlights.set(name, new Highlight(range));
    return () => {
      CSS.highlights.delete(name);
    };
  }, [name, range]);
}
