"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import { failureSentence } from "./failure-copy";
import {
  buildQueue,
  firstItemFrom,
  gapAfter,
  KEEP_BEHIND,
  nextBlockItem,
  planFetches,
  planRevokes,
  previousItem,
  type QueueItem,
  TITLE_BLOCK,
} from "./listen-queue";
import { getArticleBody, getParagraphs } from "./paragraphs";
import { spokenBlock } from "./spoken-text";

/**
 * Makes one clip of speech for `text`. Convex actions can't be cancelled, so
 * `signal` only lets the player ignore a result that arrives after Stop.
 */
export type ClipSource = (text: string, signal: AbortSignal) => Promise<Blob>;

export type ListenStatus =
  | "idle"
  | "preparing"
  | "playing"
  | "gap"
  | "paused"
  | "failed"
  | "finished";

export interface PlayerSnapshot {
  status: ListenStatus;
  /** The block being spoken or waited for, `null` when nothing is. */
  index: number | null;
  /** The sentence to show while `failed`. */
  error: string | null;
}

const IDLE: PlayerSnapshot = { status: "idle", index: null, error: null };

// A silent clip played inside the click or keypress, so mobile browsers count
// the element as user-activated for the rest of the session (05-player)
const SILENT_CLIP =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

type ClipEntry =
  | { status: "pending" }
  | { status: "ready"; url: string }
  | { status: "failed"; error: unknown };

interface PlayerEnv {
  paragraphs: () => HTMLElement[];
  clipSource: () => ClipSource;
  /** The spoken title, said before the first paragraph of a listen from the top. */
  intro: () => string | undefined;
  publish: (snapshot: PlayerSnapshot) => void;
}

function clearMarks() {
  for (const el of document.querySelectorAll(
    "[data-speaking], [data-speaking-pending]",
  )) {
    el.removeAttribute("data-speaking");
    el.removeAttribute("data-speaking-pending");
  }
}

const isAbort = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

/**
 * The state machine of 05-player. It lives outside React so that the audio
 * events, timers and fetch completions that drive it all see one current
 * state; the hook only publishes snapshots. Every async completion checks the
 * `session` it began in, which Stop, restart and unmount all advance.
 */
function createPlayer(env: PlayerEnv) {
  let audio: HTMLAudioElement | null = null;
  let session = 0;
  let abort: AbortController | null = null;
  let paragraphs: HTMLElement[] = [];
  let queue: QueueItem[] = [];
  const clips = new Map<number, ClipEntry>();
  let playing = -1;
  /** The object URL set on the audio element for the item at `playing`. */
  let loaded: string | null = null;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;
  let resume: (() => void) | null = null;
  let status: ListenStatus = "idle";
  let scrolledBlock = -1;
  /** Counts pauses, so a play() that began before one doesn't announce "playing" after it. */
  let pauses = 0;

  function set(next: ListenStatus, error: string | null = null) {
    status = next;
    // The title item is announced as the first paragraph, which it precedes
    const block = queue[playing] ? Math.max(0, queue[playing].block) : null;
    env.publish(
      next === "idle" || next === "finished"
        ? { status: next, index: null, error: null }
        : { status: next, index: block, error },
    );
  }

  function mark(block: number, kind: "speaking" | "pending") {
    clearMarks();
    const el = paragraphs[block];
    if (!el) return;
    el.setAttribute(
      kind === "speaking" ? "data-speaking" : "data-speaking-pending",
      "",
    );
    if (scrolledBlock === block) return;
    scrolledBlock = block;
    const rect = el.getBoundingClientRect();
    if (rect.top < 80 || rect.bottom > window.innerHeight - 80)
      el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function onEnded() {
    if (loaded === null || audio?.src !== loaded) return;
    const next = playing + 1;
    if (next >= queue.length) {
      teardown();
      set("finished");
      return;
    }
    const wait = gapAfter(queue, playing, document.hidden);
    if (wait === 0) {
      begin(next);
      return;
    }
    set("gap");
    resume = () => begin(next);
    gapTimer = setTimeout(() => {
      resume = null;
      begin(next);
    }, wait);
  }

  function onError() {
    if (loaded === null || audio?.src !== loaded) return;
    const i = playing;
    discard(i);
    fail(i, new Error("The clip could not be played."));
  }

  function ensureAudio(): HTMLAudioElement {
    if (!audio) {
      audio = new Audio();
      audio.preservesPitch = true;
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
    }
    return audio;
  }

  function revokeEntry(i: number) {
    const entry = clips.get(i);
    if (entry?.status === "ready") URL.revokeObjectURL(entry.url);
    clips.delete(i);
  }

  /** Drops a clip that can't be played and unloads it from the element. */
  function discard(i: number) {
    loaded = null;
    revokeEntry(i);
    clips.set(i, { status: "failed", error: new Error("playback") });
  }

  function teardown() {
    session += 1;
    abort?.abort();
    abort = null;
    clearTimeout(gapTimer);
    resume = null;
    loaded = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    for (const i of [...clips.keys()]) revokeEntry(i);
    queue = [];
    paragraphs = [];
    playing = -1;
    scrolledBlock = -1;
    clearMarks();
  }

  function request(i: number) {
    const token = session;
    const entry: ClipEntry = { status: "pending" };
    clips.set(i, entry);
    const source = env.clipSource();
    const signal = abort?.signal ?? new AbortController().signal;
    // Whatever the outcome, a request that ends frees a slot, so the current run
    // plans again; otherwise a skip made while both slots were full never gets
    // its own item requested
    const behind = () => i < playing - KEEP_BEHIND;
    new Promise<Blob>((resolve) => resolve(source(queue[i].text, signal))).then(
      (blob) => {
        // Stop, restart or unmount ran while this was in flight: the result is
        // late, so no object URL is ever made for it
        if (token !== session || clips.get(i) !== entry) return;
        if (behind()) {
          clips.delete(i);
        } else {
          const url = URL.createObjectURL(blob);
          clips.set(i, { status: "ready", url });
          if (status === "preparing" && playing === i) play(i, url);
        }
        fetchAhead();
      },
      (error: unknown) => {
        if (token !== session || clips.get(i) !== entry) return;
        if (behind()) {
          clips.delete(i);
        } else {
          clips.set(i, { status: "failed", error });
          if (status === "preparing" && playing === i) fail(i, error);
        }
        fetchAhead();
      },
    );
  }

  const statuses = () =>
    new Map([...clips].map(([i, entry]) => [i, entry.status] as const));

  function fetchAhead() {
    for (const i of planFetches(queue.length, playing, statuses())) request(i);
  }

  function revokeBehind() {
    for (const i of planRevokes(playing, statuses())) revokeEntry(i);
  }

  /** Starts the element on `loaded` and, once the sound has begun, moves the highlight. */
  function playLoaded(i: number) {
    const token = session;
    const url = loaded;
    const pausedAt = pauses;
    const attempt = ensureAudio().play();
    resume = null;
    attempt.then(
      () => {
        if (token !== session || loaded !== url || pausedAt !== pauses) return;
        mark(queue[i].block, "speaking");
        set("playing");
        resume = null;
      },
      (error: unknown) => {
        if (token !== session || loaded !== url || isAbort(error)) return;
        fail(i, error);
      },
    );
  }

  function play(i: number, url: string) {
    loaded = url;
    ensureAudio().src = url;
    playLoaded(i);
  }

  function prepare(i: number) {
    set("preparing");
    const block = queue[i].block;
    if (!paragraphs[block]?.hasAttribute("data-speaking"))
      mark(block, "pending");
    resume = () => begin(i);
  }

  function fail(i: number, error: unknown) {
    audio?.pause();
    playing = i;
    clearTimeout(gapTimer);
    const block = queue[i].block;
    if (!paragraphs[block]?.hasAttribute("data-speaking"))
      mark(block, "pending");
    set("failed", failureSentence(error, "The voice stopped."));
  }

  /** Moves the voice to item `i`: plays it if its clip is ready, else waits for it. */
  function begin(i: number) {
    playing = i;
    clearTimeout(gapTimer);
    revokeBehind();
    fetchAhead();
    const entry = clips.get(i);
    if (entry?.status === "ready") play(i, entry.url);
    else if (entry?.status === "failed") fail(i, entry.error);
    else prepare(i);
  }

  function retry() {
    if (status !== "failed" || playing < 0) return;
    if (clips.get(playing)?.status === "failed") clips.delete(playing);
    begin(playing);
  }

  function jump(i: number) {
    loaded = null;
    audio?.pause();
    begin(i);
  }

  return {
    /** Starts at `block`. Must run inside the click or keypress, before any await. */
    start(block: number) {
      teardown();
      const el = ensureAudio();
      el.src = SILENT_CLIP;
      el.play().catch(() => undefined);
      paragraphs = env.paragraphs();
      abort = new AbortController();
      const lang = document.documentElement.lang || "en";
      const from = Math.max(0, block);
      queue = buildQueue(paragraphs.map(spokenBlock), from, lang, env.intro());
      const first = firstItemFrom(queue, from === 0 ? TITLE_BLOCK : from);
      if (first === null) {
        teardown();
        set("finished");
        return;
      }
      begin(first);
    },
    stop() {
      const wasIdle = status === "idle";
      teardown();
      if (!wasIdle) set("idle");
    },
    togglePause() {
      if (status === "paused") {
        const continueFrom = resume;
        resume = null;
        continueFrom?.();
        return;
      }
      if (status === "playing") {
        pauses += 1;
        audio?.pause();
        const i = playing;
        set("paused");
        resume = () => playLoaded(i);
      } else if (status === "gap" || status === "preparing") {
        pauses += 1;
        clearTimeout(gapTimer);
        set("paused");
      }
    },
    next() {
      if (playing < 0) return;
      const target = nextBlockItem(queue, playing);
      if (target === null) {
        teardown();
        set("finished");
      } else jump(target);
    },
    previous() {
      if (playing < 0) return;
      jump(previousItem(queue, playing, audio?.currentTime ?? 0));
    },
    retry,
  };
}

/**
 * Reads the article aloud with natural voices: one clip per block, made by
 * `clipSource` and played through a single audio element (05-player).
 */
export function useNaturalVoice(
  containerRef: RefObject<HTMLElement | null>,
  articleId: string | undefined,
  unitKey: string | null | undefined,
  content: string | undefined,
  contentHtml: string | undefined,
  clipSource: ClipSource | undefined,
  intro?: string,
) {
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>(IDLE);
  const source = useRef(clipSource);
  source.current = clipSource;
  const container = useRef(containerRef);
  container.current = containerRef;
  const spokenIntro = useRef(intro);
  spokenIntro.current = intro;
  const player = useRef<ReturnType<typeof createPlayer>>(null);
  player.current ??= createPlayer({
    paragraphs: () => getParagraphs(getArticleBody(container.current.current)),
    clipSource: () =>
      source.current ??
      (() => Promise.reject(new Error("No speech source is wired in."))),
    intro: () => spokenIntro.current,
    publish: (next) =>
      setSnapshot((prev) =>
        prev.status === next.status &&
        prev.index === next.index &&
        prev.error === next.error
          ? prev
          : next,
      ),
  });
  const current = player.current;

  // Prose identity, not paragraph geometry or arriving annotations, ends speech.
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity changes invalidate the captured paragraph array
  useEffect(() => {
    current.stop();
    return current.stop;
  }, [current, articleId, unitKey, content, contentHtml]);

  return {
    supported: typeof Audio !== "undefined",
    index: snapshot.index,
    paused: snapshot.status === "paused",
    active: !["idle", "finished"].includes(snapshot.status),
    status: snapshot.status,
    error: snapshot.error,
    speakFrom: current.start,
    togglePause: current.togglePause,
    stop: current.stop,
    previous: current.previous,
    next: current.next,
    retry: current.retry,
  };
}
