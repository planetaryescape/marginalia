"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { abortable } from "./abortable";
import { answerBuffer } from "./answer-buffer";
import { companionContext } from "./companion-context";
import {
  clearAnswers,
  leaveArticle,
  restoreAnswers,
  type StoredAnswer,
  stayOnArticle,
  writeAnswers,
} from "./companion-session";
import { occurrencesBefore, senseOf, sentenceAround } from "./lookups";
import { paragraphIndexOf } from "./paragraphs";
import { type ReaderSettings, webSearchEnabled } from "./reader-settings";
import { postReaderRequest } from "./reader-transport";
import { rangeText } from "./text-range";

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
  /** A follow-up finished but the kept record didn't take it; the card offers Retry. */
  syncFailed?: boolean;
  /** Which match of the selected words in its paragraph was selected. */
  occurrence?: number;
  /** The last paragraph the selection crosses, when it crosses more than one. */
  paragraphEnd?: number;
  /** The last completed transcript: what a refresh restores, however a follow-up ends. */
  doneTurns?: CompanionTurn[];
  /** A thread saved before answers became temporary: shown as a temporary copy until kept. */
  legacyId?: Id<"companionThreads">;
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
export async function readerRequestError(res: Response, signal?: AbortSignal) {
  const text = signal
    ? await abortable(res.text(), signal)
    : await res.text().catch(() => "");
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
  const res = await postReaderRequest(
    path.replace(/^\/api\//, ""),
    body,
    handlers.signal,
  );
  if (!res.ok || !res.body)
    throw await readerRequestError(res, handlers.signal);
  handlers.onModel(res.headers.get("X-Companion-Model"));
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), handlers.signal);
      if (done) break;
      handlers.onText(value);
    }
  } finally {
    // Do not wait for a broken upstream's cancellation handshake.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Which match of the selected words in its paragraph the range is. */
function occurrenceOf(range: Range): number {
  const paragraph = (
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
  )?.closest("[data-para]");
  if (!paragraph) return 0;
  const before = document.createRange();
  before.selectNodeContents(paragraph);
  before.setEnd(range.startContainer, range.startOffset);
  return occurrencesBefore(rangeText(before), rangeText(range));
}

/** The last paragraph a selection crosses, when it crosses more than one. */
function paragraphEndOf(range: Range): number | undefined {
  const start = paragraphIndexOf(range.startContainer);
  let end = paragraphIndexOf(range.endContainer);
  if (start === null || end === null || end <= start) return undefined;
  // A selection that stops at the very start of a block has not entered it.
  if (range.endOffset === 0) end -= 1;
  return end > start ? end : undefined;
}

/** An unkept answer with a completed transcript is held for a refresh. */
const holdsForRefresh = (a: CompanionThread) =>
  !a.savedId && (a.doneTurns?.length ?? 0) > 0;

const toStored = (a: CompanionThread): StoredAnswer => ({
  id: a.id,
  mode: a.mode,
  selection: a.selection,
  question: a.question,
  paragraphIndex: a.paragraphIndex,
  // Not `turns`: a follow-up that is still streaming or failed must not cost
  // the completed answer before it.
  turns: a.doneTurns ?? a.turns,
  model: a.model ?? null,
  occurrence: a.occurrence,
  paragraphEnd: a.paragraphEnd,
  legacyId: a.legacyId,
});

const fromStored = (a: StoredAnswer): CompanionThread => ({
  ...a,
  doneTurns: a.turns,
  // SAFETY: only fromDoc sets legacyId, from a companionThreads document's own _id.
  legacyId: a.legacyId as Id<"companionThreads"> | undefined,
  status: "done",
});

type ReopenThread = Pick<
  Doc<"companionThreads">,
  | "_id"
  | "mode"
  | "selection"
  | "question"
  | "paragraphIndex"
  | "turns"
  | "model"
  | "keptAt"
>;

const fromDoc = (doc: ReopenThread): CompanionThread => ({
  id: doc._id,
  // Only an answer the reader chose to keep is a kept record. An older,
  // automatically saved thread is a temporary copy: its follow-ups stay
  // temporary, and Keep upgrades that same row.
  savedId: doc.keptAt === undefined ? undefined : doc._id,
  legacyId: doc.keptAt === undefined ? doc._id : undefined,
  mode: doc.mode,
  selection: doc.selection,
  question: doc.question,
  paragraphIndex: doc.paragraphIndex ?? null,
  turns: doc.turns,
  doneTurns: doc.turns,
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
  unitIndex = null,
}: {
  articleId: Id<"articles">;
  /** The part of a book on screen. Answers belong to it: their paragraph numbers are its own. */
  unitIndex?: number | null;
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
  const flushers = useRef(new Map<string, () => void>());
  // What this visit's answers are filed under in session storage
  const scope = unitIndex === null ? articleId : `${articleId}:${unitIndex}`;
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

  /** Writes a kept answer's transcript to its record, marking the card when that fails. */
  const syncKept = useCallback(
    (id: string, savedId: Id<"companionThreads">) => {
      const current = answersRef.current.find((a) => a.id === id);
      if (!current) return;
      patch(id, (t) => ({ ...t, syncFailed: false }));
      updateTurns({
        threadId: savedId,
        turns: current.turns,
        model: current.model ?? undefined,
      }).catch(() => patch(id, (t) => ({ ...t, syncFailed: true })));
    },
    [patch, updateTurns],
  );

  // Arriving on an article restores a refresh's answers; leaving it clears them.
  // Cleanup does not run on a refresh, so a refresh never clears.
  useEffect(() => {
    live.current = scope;
    stayOnArticle(scope);
    set(restoreAnswers(scope).map(fromStored));
    setOpenId(null);
    const running = controllers.current;
    return () => {
      live.current = null;
      for (const flush of flushers.current.values()) flush();
      flushers.current.clear();
      leaveArticle(scope);
      for (const controller of running.values()) controller.abort();
      running.clear();
    };
  }, [scope, set, setOpenId]);

  // Coming back from the back/forward cache restores the page as it was, but
  // the reader left the article: its unkept answers are gone, as after any leave.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      clearAnswers(scope);
      for (const a of answersRef.current)
        if (!a.savedId) controllers.current.get(a.id)?.abort();
      set(answersRef.current.filter((a) => a.savedId));
      if (!answersRef.current.some((a) => a.id === openIdRef.current))
        setOpenId(null);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [scope, set, setOpenId]);

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
      const context = companionContext(containerRef.current, base);
      const { paragraphs } = context;

      // Define is told which usage of the words was selected, not just the words.
      const sentence =
        context.sentence ??
        (base.mode === "define"
          ? sentenceAround(
              base.paragraphIndex === null
                ? ""
                : (paragraphs[
                    context.paragraphIndices?.indexOf(base.paragraphIndex) ??
                      base.paragraphIndex
                  ] ?? ""),
              base.selection,
              base.occurrence,
            )
          : undefined);

      let answer = "";
      let model: string | null = base.model ?? null;
      const current = () =>
        controllers.current.get(base.id) === controller &&
        live.current === scope;
      const buffer = answerBuffer(() => {
        if (!current()) return;
        patch(base.id, (t) => {
          const turns = t.turns.slice();
          turns[turns.length - 1] = { role: "assistant", content: answer };
          return { ...t, turns };
        });
      });
      flushers.current.set(base.id, buffer.flush);
      try {
        await streamFromConvex(
          "/api/companion",
          {
            mode: base.mode,
            articleId,
            // A book is answered from its outline and matching passages, with this part on screen
            unitIndex:
              base.mode === "article" ? (unitIndex ?? undefined) : undefined,
            title,
            ...context,
            selection: base.selection,
            paragraphIndex: context.paragraphIndex ?? base.paragraphIndex,
            paragraphEnd: context.paragraphEnd ?? base.paragraphEnd,
            sentence,
            // Define names the usage; a passage Ask's long paragraph is cut around it
            occurrence:
              sentence || base.mode === "ask"
                ? (base.occurrence ?? 0)
                : undefined,
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
              if (!current()) return;
              model = m;
              patch(base.id, (t) => ({ ...t, model: m }));
            },
            onText: (chunk) => {
              if (!current() || controller.signal.aborted) return;
              answer += chunk;
              buffer.schedule();
            },
          },
        );
        if (!answer.trim()) throw new Error("No answer came back. Try again.");
      } catch (error) {
        if (controller.signal.aborted || !current()) return;
        patch(base.id, (t) => ({
          ...t,
          status: "error",
          error:
            error instanceof Error && error.message
              ? error.message
              : "Something went wrong.",
        }));
        return;
      } finally {
        buffer.flush();
        if (current()) flushers.current.delete(base.id);
      }

      if (!current() || controller.signal.aborted) return;

      const turns = [
        ...history,
        { role: "assistant" as const, content: answer },
      ];
      patch(
        base.id,
        (t) => ({ ...t, turns, doneTurns: turns, model, status: "done" }),
        true,
      );

      // A kept answer is the reader's record, so its follow-ups join it.
      const savedId = answersRef.current.find((a) => a.id === base.id)?.savedId;
      if (savedId) syncKept(base.id, savedId);

      // The lookup log keeps every completed Define, kept or not (D-DES-058).
      // Follow-ups are not new lookups, and Regenerate repeats the same one.
      if (base.mode === "define" && history.length === 0)
        recordLookup({
          articleId,
          unitIndex: unitIndex ?? undefined,
          word: base.selection,
          sentence: sentence ?? "",
          paragraphIndex: base.paragraphIndex ?? undefined,
          occurrence: base.occurrence ?? 0,
          sense: senseOf(answer),
        }).catch((error) => console.error("Couldn't log the lookup", error));
    },
    [
      articleId,
      containerRef,
      patch,
      recordLookup,
      set,
      setOpenId,
      syncKept,
      unitIndex,
      scope,
    ],
  );

  const start = useCallback(
    (args: { mode: CompanionMode; range: Range; question?: string }) => {
      const selection = rangeText(args.range);
      if (!selection) return;
      run(
        {
          id: crypto.randomUUID(),
          mode: args.mode,
          selection,
          question: args.question,
          paragraphIndex: paragraphIndexOf(args.range.startContainer),
          occurrence: occurrenceOf(args.range),
          paragraphEnd: paragraphEndOf(args.range),
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
    (doc: ReopenThread) => {
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
          unitIndex: unitIndex ?? undefined,
          answerId: current.id,
          legacyId: current.legacyId,
          mode: current.mode,
          selection: current.selection,
          question: current.question,
          paragraphIndex: current.paragraphIndex ?? undefined,
          turns: current.turns,
          model: current.model ?? undefined,
        });
        // Saving it drops it from session storage: the record is now the copy.
        patch(
          id,
          (t) => ({ ...t, savedId, legacyId: undefined, keeping: false }),
          true,
        );
        return true;
      } catch {
        patch(id, (t) => ({ ...t, keeping: false }));
        return false;
      }
    },
    [articleId, unitIndex, keepThread, patch],
  );

  /** Retries writing a kept answer's latest transcript after a failed update. */
  const resync = useCallback(
    (id: string) => {
      const savedId = answersRef.current.find((a) => a.id === id)?.savedId;
      if (savedId) syncKept(id, savedId);
    },
    [syncKept],
  );

  /** Folds the open answer back into the margin; it stays for the visit. */
  const collapse = useCallback(() => setOpenId(null), [setOpenId]);

  const stop = useCallback(
    (id: string) => {
      if (
        answersRef.current.find((answer) => answer.id === id)?.status !==
        "streaming"
      )
        return;
      flushers.current.get(id)?.();
      controllers.current.get(id)?.abort();
      patch(id, (t) => ({ ...t, status: "error", error: "Stopped." }));
    },
    [patch],
  );

  const remove = useCallback(
    async (id: string) => {
      const current = answersRef.current.find((a) => a.id === id);
      // Dismissing while Keep is writing would leave the new record behind.
      if (!current || current.keeping) return;
      // Deleting an older saved answer deletes its row too, or it would return.
      // The row goes first: if that fails the answer is still here to Retry.
      const recordId = current.savedId ?? current.legacyId;
      if (recordId) await removeThread({ threadId: recordId });
      controllers.current.get(id)?.abort();
      controllers.current.delete(id);
      set(
        answersRef.current.filter((a) => a.id !== id),
        true,
      );
      if (openIdRef.current === id) setOpenId(null);
    },
    [removeThread, set, setOpenId],
  );

  /** Drops an answer whose record was deleted elsewhere, such as in the notes pane. */
  const forget = useCallback(
    (recordId: string) => {
      const gone = answersRef.current.filter(
        (a) =>
          a.id === recordId ||
          a.savedId === recordId ||
          a.legacyId === recordId,
      );
      if (!gone.length) return;
      for (const a of gone) controllers.current.get(a.id)?.abort();
      set(
        answersRef.current.filter((a) => !gone.includes(a)),
        true,
      );
      if (gone.some((a) => a.id === openIdRef.current)) setOpenId(null);
    },
    [set, setOpenId],
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
    stop,
    followUp,
    regenerate,
    keep,
    resync,
    remove,
    forget,
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
