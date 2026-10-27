"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { sourceHash } from "@marginalia/backend/prepared-representation";
import { useMutation } from "convex/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { StudySelection } from "./bible-study-selection";

type StudyTarget = {
  studyId: Id<"scriptureStudies">;
  runId: Id<"scriptureStudyRuns">;
};
export type OpenStudy = {
  selection: StudySelection;
  studyId: Id<"scriptureStudies"> | null;
  pending: boolean;
  error: string | null;
};

/** Explicit events admit work; subscriptions and re-renders never spend again. */
export function useScriptureStudy(
  article:
    | {
        _id: Id<"articles">;
        content?: string;
        contentHtml?: string;
      }
    | null
    | undefined,
) {
  const admit = useMutation(api.scriptureStudy.start);
  const cancel = useMutation(api.scriptureStudy.cancel);
  const [pane, setPane] = useState<OpenStudy | null>(null);
  const target = useRef<StudyTarget | null>(null);
  const admitting = useRef<Promise<StudyTarget> | null>(null);
  const starting = useRef<{ key: string; task: Promise<void> } | null>(null);
  const intent = useRef(0);
  const mounted = useRef(true);
  const articleId = article?._id;
  const content = article?.content;
  const contentHtml = article?.contentHtml;
  const currentArticle = useRef(articleId);
  useLayoutEffect(() => {
    currentArticle.current = articleId;
  }, [articleId]);

  const close = useCallback(async () => {
    const revision = ++intent.current;
    let active = target.current;
    if (!active && admitting.current) {
      try {
        active = await admitting.current;
      } catch {
        /* Rejected admission did not produce a run to cancel. */
      }
    }
    if (active) {
      target.current = active;
      try {
        await cancel(active);
      } catch {
        if (mounted.current && intent.current === revision)
          setPane((current) =>
            current
              ? {
                  ...current,
                  error:
                    "Could not confirm cancellation. Keep this study open and try closing again.",
                }
              : current,
          );
        return false;
      }
    }
    if (intent.current !== revision) return false;
    target.current = null;
    setPane(null);
    return true;
  }, [cancel]);

  const start = useCallback(
    (selection: StudySelection): Promise<void> => {
      if (!articleId || articleId !== currentArticle.current)
        return Promise.resolve();
      const key = JSON.stringify([articleId, selection]);
      if (starting.current?.key === key) return starting.current.task;
      const run = async () => {
        if (!(await close())) return;
        const revision = ++intent.current;
        const requestKey = crypto.randomUUID();
        setPane({ selection, studyId: null, pending: true, error: null });
        let dispatched: Promise<StudyTarget> | null = null;
        try {
          const hash = await sourceHash(content, contentHtml);
          if (!mounted.current || revision !== intent.current) return;
          const request = admit({
            articleId,
            selection,
            sourceHash: hash,
            requestKey,
          }).then((admitted) => ({
            studyId: admitted.studyId,
            runId: admitted.runId,
          }));
          admitting.current = request;
          dispatched = request;
          const active = await request;
          if (admitting.current === request) admitting.current = null;
          if (!mounted.current || revision !== intent.current) {
            await cancel(active);
            return;
          }
          target.current = active;
          setPane({
            selection,
            studyId: active.studyId,
            pending: false,
            error: null,
          });
        } catch (error) {
          if (mounted.current && revision === intent.current)
            setPane({
              selection,
              studyId: null,
              pending: false,
              error:
                error instanceof Error
                  ? error.message
                  : "The study could not start. Try again.",
            });
        } finally {
          if (admitting.current === dispatched) admitting.current = null;
        }
      };
      const task = run();
      starting.current = { key, task };
      return task.finally(() => {
        if (starting.current?.task === task) starting.current = null;
      });
    },
    [admit, articleId, content, contentHtml, cancel, close],
  );

  const reopen = useCallback(
    async (
      studyId: Id<"scriptureStudies">,
      selection: StudySelection,
      runId: Id<"scriptureStudyRuns"> | null,
    ) => {
      if (!(await close())) return;
      ++intent.current;
      target.current = runId ? { studyId, runId } : null;
      setPane({ selection, studyId, pending: false, error: null });
    },
    [close],
  );

  const trackRun = useCallback((active: StudyTarget) => {
    target.current = active;
  }, []);
  const forget = useCallback(() => {
    ++intent.current;
    target.current = null;
    setPane(null);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: article identity is the lifecycle boundary for cancellation and local pane state.
  useEffect(() => {
    mounted.current = true;
    target.current = null;
    setPane(null);
    return () => {
      mounted.current = false;
      ++intent.current;
      const active = target.current;
      if (active)
        void cancel(active).catch(() => {
          /* Server lease still fences expiry. */
        });
    };
  }, [cancel, articleId]);

  return { pane, start, reopen, close, trackRun, forget };
}
