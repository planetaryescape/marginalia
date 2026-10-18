"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";

type SessionId = Id<"sessions"> | undefined;
type Action = "presented" | "skipped" | "saved";

export type SessionRecorder = {
  /** Queued until the session id exists, then sent in the order it was called. */
  record: (input: { articleId: Id<"articles">; action: Action }) => void;
  /** Queues the open and returns stable URL attribution without waiting for creation. */
  open: (articleId: Id<"articles">) => string;
};

/**
 * Creates the session record in the background so nothing on the desk waits
 * for it. Interactions made before the id arrives are queued against this
 * session, whichever time the reader has switched to since. If the session
 * can't be created the interactions are still recorded, without one.
 */
export function useSessionRecorder(input: {
  requestedMinutes: number;
  /** A deep link brings the session that already exists. */
  existingId?: Id<"sessions">;
}): SessionRecorder {
  const createSession = useMutation(api.sessions.create);
  const recordInteraction = useMutation(api.sessions.recordInteraction);
  const updateStatus = useMutation(api.sessions.updateStatus);
  const [clientKey] = useState(() => crypto.randomUUID());

  const [ready] = useState(() => {
    let resolve: (id: SessionId) => void = () => {};
    const promise = new Promise<SessionId>((r) => {
      resolve = r;
    });
    // A deep link brings a session that already exists
    if (input.existingId) resolve(input.existingId);
    return { promise, resolve };
  });
  const tail = useRef<Promise<void>>(Promise.resolve());
  const started = useRef(false);

  useEffect(() => {
    // A ref survives React's development re-run of effects, so this creates one session
    if (started.current || input.existingId) return;
    started.current = true;
    createSession({ requestedMinutes: input.requestedMinutes, clientKey }).then(
      ready.resolve,
      (error) => {
        console.error("Couldn't create the session", error);
        ready.resolve(undefined);
      },
    );
  }, [
    createSession,
    ready,
    input.existingId,
    input.requestedMinutes,
    clientKey,
  ]);

  const enqueue = (task: (sessionId: SessionId) => Promise<void>) => {
    tail.current = tail.current.then(async () => {
      try {
        await task(await ready.promise);
      } catch (error) {
        console.error("Couldn't record that interaction", error);
      }
    });
  };

  return {
    record: ({ articleId, action }) => {
      const send = async (sessionId: SessionId) => {
        await recordInteraction({ articleId, sessionId, action });
      };
      // An offer is not an outcome the others wait on: it joins no queue, so
      // a slow one never delays a reader's skip, save or open
      if (action === "presented")
        void ready.promise
          .then(send)
          .catch((error) =>
            console.error("Couldn't record that interaction", error),
          );
      else enqueue(send);
    },
    open: (articleId) => {
      enqueue(async (resolvedId) => {
        const sessionId =
          resolvedId ??
          (await createSession({
            requestedMinutes: input.requestedMinutes,
            clientKey,
          }));
        await recordInteraction({ articleId, sessionId, action: "opened" });
        if (sessionId)
          await updateStatus({
            sessionId,
            readingStatus: "reading",
            articleId,
          });
      });
      return input.existingId
        ? `session=${encodeURIComponent(input.existingId)}`
        : `sessionKey=${clientKey}&minutes=${input.requestedMinutes}`;
    },
  };
}
