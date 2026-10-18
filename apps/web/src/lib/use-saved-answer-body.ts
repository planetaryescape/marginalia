"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type SavedAnswerBody = NonNullable<
  FunctionReturnType<typeof api.companionThreads.getBody>
>;

/** One chosen answer, never a batch. A late request cannot reopen a folded
 * card, replace a newer selection, or open in another article/book part. */
export function useSavedAnswerBody(
  scope: { articleId: Id<"articles">; unitIndex?: number },
  onOpen: (body: SavedAnswerBody) => void,
) {
  const convex = useConvex();
  const { articleId, unitIndex } = scope;
  const scopeKey = `${articleId}:${unitIndex ?? ""}`;
  const epoch = useRef(0);
  const scopeRef = useRef({ ...scope, key: scopeKey });
  useLayoutEffect(() => {
    if (scopeRef.current.key !== scopeKey) {
      epoch.current++;
      scopeRef.current = { articleId, unitIndex, key: scopeKey };
    }
  }, [articleId, unitIndex, scopeKey]);
  const onOpenRef = useRef(onOpen);
  useLayoutEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  const mounted = useRef(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestScope, setRequestScope] = useState(scopeKey);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, []);
  const cancel = useCallback(() => {
    epoch.current++;
    setPendingId(null);
    setError(null);
  }, []);
  const open = useCallback(
    async (threadId: Id<"companionThreads">) => {
      const request = ++epoch.current;
      const requestedScope = scopeRef.current;
      setRequestScope(requestedScope.key);
      setPendingId(threadId);
      setError(null);
      const current = () =>
        mounted.current &&
        epoch.current === request &&
        scopeRef.current.key === requestedScope.key;
      try {
        const body = await convex.query(api.companionThreads.getBody, {
          threadId,
        });
        if (!current()) return;
        if (
          body &&
          body.articleId === requestedScope.articleId &&
          body.unitIndex === requestedScope.unitIndex
        )
          onOpenRef.current(body);
        else setError("This answer is no longer available.");
      } catch {
        if (current())
          setError("Couldn't load the answer. Try opening it again.");
      } finally {
        if (current()) setPendingId(null);
      }
    },
    [convex],
  );
  return {
    open,
    cancel,
    pendingId: requestScope === scopeKey ? pendingId : null,
    error: requestScope === scopeKey ? error : null,
  };
}
