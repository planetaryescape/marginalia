"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { z } from "zod";
import {
  HIGHLIGHTER_COLORS,
  type HighlighterColor,
  PEN_COLORS,
  type PenColor,
} from "./mark-colours";
import {
  DEFAULT_SETTINGS,
  parseReaderSettings,
  useReaderSettings,
} from "./reader-settings";

export type MarkKind = "highlight" | "underline";
type Defaults = { highlighter: HighlighterColor; pen: PenColor };
type Tools = { highlight: boolean; underline: boolean };
type Snapshot = {
  readerId: string | null;
  colors: Defaults;
  persisted: boolean;
  intentional: Tools;
};
type Provisional = { colors: Defaults; allowed: Tools };
const SETTINGS_KEY = "marginalia:reader-settings";
const defaultsSchema = z.object({
  highlighter: z.enum(HIGHLIGHTER_COLORS),
  pen: z.enum(PEN_COLORS),
});

// Only a provisional, in-memory freeze while offline/initializing. Never read
// or write a browser-persisted migration baseline: the server always wins.
const provisional = new Map<string, Provisional>();
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<void>>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;
const noProvisional = () => null;

function freezeProvisional(readerId: string, snapshot: Snapshot) {
  const previous = provisional.get(readerId);
  // Preference writes after mounting (e.g. choosing a theme in a QA profile)
  // are not evidence of a prior colour preference. Only explicit colour intent
  // can promote an already-captured fresh profile during this visit.
  const allowed = {
    highlight: previous
      ? previous.allowed.highlight || snapshot.intentional.highlight
      : snapshot.persisted || snapshot.intentional.highlight,
    underline: previous
      ? previous.allowed.underline || snapshot.intentional.underline
      : snapshot.persisted || snapshot.intentional.underline,
  };
  if (
    previous &&
    previous.allowed.highlight === allowed.highlight &&
    previous.allowed.underline === allowed.underline
  )
    return;
  provisional.set(readerId, {
    colors: previous?.colors ?? snapshot.colors,
    allowed,
  });
  for (const listener of listeners) listener();
}

/** Read actual browser preferences, not useSyncExternalStore's temporary SSR
 * snapshot. Storage denial differs from a missing/invalid stored preference. */
function browserDefaults(): { colors: Defaults; persisted: boolean } | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SETTINGS_KEY);
  } catch {
    return null;
  }
  let current = DEFAULT_SETTINGS;
  let persisted = false;
  try {
    const value = raw ? JSON.parse(raw) : {};
    current = parseReaderSettings(value);
    persisted = raw !== null && defaultsSchema.safeParse(value).success;
  } catch {
    // Matches the settings store's handling of corrupt JSON.
  }
  return {
    colors: { highlighter: current.highlighter, pen: current.pen },
    persisted,
  };
}

function useLegacyDefaultsState() {
  const { settings } = useReaderSettings();
  const status = useQuery(api.highlights.legacyDefaults, {});
  const readerId = status?.readerId;
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    clientHydrated,
    serverHydrated,
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const frozen = useSyncExternalStore(
    subscribe,
    () => (readerId ? (provisional.get(readerId) ?? null) : null),
    noProvisional,
  );

  const freeze = useCallback(
    (intentionalKind?: MarkKind) => {
      const actual = browserDefaults();
      if (!hydrated && !actual) return;
      const owner = readerId ?? null;
      const captured: Snapshot =
        snapshot && (snapshot.readerId === owner || snapshot.readerId === null)
          ? { ...snapshot, readerId: owner }
          : {
              readerId: owner,
              colors: actual?.colors ?? {
                highlighter: settings.highlighter,
                pen: settings.pen,
              },
              persisted: actual?.persisted ?? false,
              intentional: { highlight: false, underline: false },
            };
      if (intentionalKind)
        captured.intentional = {
          ...captured.intentional,
          [intentionalKind]: true,
        };
      setSnapshot((previous) => {
        if (previous?.readerId !== owner) return captured;
        if (!intentionalKind || previous.intentional[intentionalKind])
          return previous;
        return {
          ...previous,
          intentional: { ...previous.intentional, [intentionalKind]: true },
        };
      });
      if (readerId) freezeProvisional(readerId, captured);
    },
    [hydrated, readerId, snapshot, settings.highlighter, settings.pen],
  );

  useEffect(() => {
    freeze();
  }, [freeze]);

  const stamp = useMutation(api.highlights.stampUncoloured);
  const highlighter =
    status?.highlighter?.color ??
    frozen?.colors.highlighter ??
    snapshot?.colors.highlighter ??
    settings.highlighter;
  const pen =
    status?.pen?.color ??
    frozen?.colors.pen ??
    snapshot?.colors.pen ??
    settings.pen;
  const highlighterReady = status?.highlighter?.ready;
  const penReady = status?.pen?.ready;
  const highlighterAllowed =
    Boolean(status?.highlighter) || frozen?.allowed.highlight === true;
  const penAllowed = Boolean(status?.pen) || frozen?.allowed.underline === true;
  useEffect(() => {
    // A fresh/default QA profile may render, but only persisted validated prior
    // preferences or an intentional colour click may choose a durable baseline.
    if (!hydrated || !readerId || !frozen) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 5_000;
    const observed = new Map<MarkKind, Promise<void>>();
    const prepare = () => {
      if (stopped || navigator.onLine === false) return;
      for (const kind of ["highlight", "underline"] as const) {
        if (kind === "highlight" ? highlighterReady : penReady) continue;
        if (kind === "highlight" ? !highlighterAllowed : !penAllowed) continue;
        const key = `${readerId}:${kind}`;
        let request = inFlight.get(key);
        if (!request) {
          request = stamp({
            kind,
            color: kind === "highlight" ? highlighter : pen,
            expectedReaderId: readerId,
          }).then(() => undefined);
          inFlight.set(key, request);
          void request.then(
            () => inFlight.delete(key),
            () => inFlight.delete(key),
          );
        }
        if (observed.get(kind) === request) continue;
        observed.set(kind, request);
        // A replacement effect also observes an existing request's failure;
        // readiness changes must not strand a failed kickoff without a retry.
        void request.catch(() => {
          if (!stopped && retry === undefined) {
            retry = setTimeout(() => {
              retry = undefined;
              prepare();
            }, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 60_000);
          }
        });
      }
    };
    prepare();
    window.addEventListener("online", prepare);
    window.addEventListener("focus", prepare);
    return () => {
      stopped = true;
      clearTimeout(retry);
      window.removeEventListener("online", prepare);
      window.removeEventListener("focus", prepare);
    };
  }, [
    hydrated,
    readerId,
    frozen,
    highlighter,
    pen,
    highlighterReady,
    penReady,
    highlighterAllowed,
    penAllowed,
    stamp,
  ]);

  const colors = useMemo(() => ({ highlighter, pen }), [highlighter, pen]);
  return { colors, readerId, freeze };
}

/** Canonical baseline also paints uncoloured rows while bounded stamping runs. */
export function useLegacyMarkDefaults() {
  const { colors, readerId } = useLegacyDefaultsState();
  return { colors, readerId };
}

/** Synchronous local change. Freezing old marks never waits on the network. */
export function useSetMarkDefault() {
  const { settings, update } = useReaderSettings();
  const { freeze } = useLegacyDefaultsState();
  return useCallback(
    (kind: MarkKind, color: string) => {
      const next =
        kind === "highlight"
          ? { highlighter: z.enum(HIGHLIGHTER_COLORS).parse(color) }
          : { pen: z.enum(PEN_COLORS).parse(color) };
      if (
        (kind === "highlight" ? settings.highlighter : settings.pen) === color
      )
        return;
      freeze(kind);
      update(next);
    },
    [freeze, update, settings.highlighter, settings.pen],
  );
}
