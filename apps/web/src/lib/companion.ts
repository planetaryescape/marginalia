"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Doc, Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONVEX_SITE_URL } from "./convex-site";
import {
  getArticleBody,
  getParagraphs,
  paragraphIndexOf,
  paragraphText,
} from "./paragraphs";
import { type ReaderSettings, webSearchEnabled } from "./reader-settings";
import { findTextRange } from "./text-range";

/** "article" is a question about the whole piece, with no highlighted passage. */
export type CompanionMode = "explain" | "simplify" | "ask" | "article";

export interface CompanionTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CompanionThread {
  /** Local identity for the open card; stays the same once the thread is saved. */
  id: string;
  savedId?: Id<"companionThreads">;
  mode: CompanionMode;
  selection: string;
  question?: string;
  paragraphIndex: number | null;
  /** Null when a saved passage can no longer be found in the article. */
  range: Range | null;
  turns: CompanionTurn[];
  status: "streaming" | "done" | "error";
  error?: string;
  model?: string | null;
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
  const res = await fetch(`${CONVEX_SITE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(
      (await res.text().catch(() => "")) || `Request failed (${res.status})`,
    );
  }
  handlers.onModel(res.headers.get("X-Companion-Model"));
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    handlers.onText(value);
  }
}

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
  const [thread, setThread] = useState<CompanionThread | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const latest = useRef({ thread, title, settings });
  useEffect(() => {
    latest.current = { thread, title, settings };
  });
  useEffect(() => () => abortRef.current?.abort(), []);

  const createThread = useMutation(api.companionThreads.create);
  const updateTurns = useMutation(api.companionThreads.updateTurns);
  const removeThread = useMutation(api.companionThreads.remove);

  const persist = useCallback(
    async (
      base: CompanionThread,
      turns: CompanionTurn[],
      model: string | null,
    ) => {
      const fields = { turns, model: model ?? undefined };
      if (base.savedId) {
        await updateTurns({ threadId: base.savedId, ...fields });
        return base.savedId;
      }
      return createThread({
        articleId,
        mode: base.mode,
        selection: base.selection,
        question: base.question,
        paragraphIndex: base.paragraphIndex ?? undefined,
        ...fields,
      });
    },
    [articleId, createThread, updateTurns],
  );

  const run = useCallback(
    async (base: CompanionThread, history: CompanionTurn[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (fn: (t: CompanionThread) => CompanionThread) =>
        setThread((t) => (t && t.id === base.id ? fn(t) : t));

      setThread({
        ...base,
        turns: [...history, { role: "assistant", content: "" }],
        status: "streaming",
        error: undefined,
      });

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
              patch((t) => ({ ...t, model: m }));
            },
            onText: (chunk) => {
              answer += chunk;
              patch((t) => {
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
        // Save before marking done so a quick follow-up can't create a duplicate.
        const savedId = await persist(
          base,
          [...history, { role: "assistant", content: answer }],
          model,
        );
        patch((t) => ({ ...t, savedId, status: "done" }));
      } catch (error) {
        if (controller.signal.aborted) return;
        patch((t) => ({
          ...t,
          status: "error",
          error:
            error instanceof Error && error.message
              ? error.message
              : "Something went wrong.",
        }));
      }
    },
    [containerRef, persist],
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
          range: args.range,
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
          range: null,
          turns: [],
          status: "streaming",
        },
        [],
      );
    },
    [run],
  );

  /** Reopens a saved thread without calling the model again. */
  const open = useCallback(
    (doc: Doc<"companionThreads">, range?: Range | null) => {
      abortRef.current?.abort();
      const paragraphIndex = doc.paragraphIndex ?? null;
      let anchor = range ?? null;
      const body = getArticleBody(containerRef.current);
      if (!anchor && body && doc.selection) {
        const preferred =
          paragraphIndex === null ? null : getParagraphs(body)[paragraphIndex];
        anchor = findTextRange(body, doc.selection, preferred);
      }
      setThread({
        id: doc._id,
        savedId: doc._id,
        mode: doc.mode,
        selection: doc.selection,
        question: doc.question,
        paragraphIndex,
        range: anchor,
        turns: doc.turns,
        status: "done",
        model: doc.model ?? null,
      });
    },
    [containerRef],
  );

  const followUp = useCallback(
    (question: string) => {
      const current = latest.current.thread;
      if (!current || current.status === "streaming" || !question.trim())
        return;
      run(current, [
        ...current.turns,
        { role: "user", content: question.trim() },
      ]);
    },
    [run],
  );

  const regenerate = useCallback(() => {
    const current = latest.current.thread;
    if (!current) return;
    const history =
      current.turns[current.turns.length - 1]?.role === "assistant"
        ? current.turns.slice(0, -1)
        : current.turns;
    run(current, history);
  }, [run]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    setThread(null);
  }, []);

  const remove = useCallback(async () => {
    const current = latest.current.thread;
    abortRef.current?.abort();
    setThread(null);
    if (current?.savedId) await removeThread({ threadId: current.savedId });
  }, [removeThread]);

  return {
    thread,
    start,
    startArticle,
    open,
    followUp,
    regenerate,
    close,
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
