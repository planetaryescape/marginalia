"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";

/** Returning `false` leaves the key to the browser (arrows keep scrolling, buttons keep Enter). */
// biome-ignore lint/suspicious/noConfusingVoidType: most handlers return nothing (or whatever router.push returns)
export type ShortcutHandler = (event: KeyboardEvent) => void | false;
export type ShortcutMap = Record<string, ShortcutHandler>;

/** What a registration adds to the `?` sheet: only keys that work right now. */
export type ShortcutHelp = { group: string; keys: [string, string][] };
export type ShortcutOptions = {
  help?: ShortcutHelp;
  /** Consulted after every other registration, so a page's own key wins. */
  fallback?: boolean;
  /**
   * Consulted before every other registration. For a surface that owns the
   * keyboard while it is open (the passage menu): the page registered first,
   * so by insertion order its own keys would win over the menu's.
   */
  priority?: boolean;
};

type Registration = { current: ShortcutMap };
const registrations = new Set<Registration>();
const registrationOptions = new WeakMap<Registration, ShortcutOptions>();
const helpListeners = new Set<() => void>();
let helpSnapshot: ShortcutHelp[] = [];

function publishHelp() {
  const merged = new Map<string, [string, string][]>();
  for (const ref of registrations) {
    const help = registrationOptions.get(ref)?.help;
    if (!help) continue;
    const keys = merged.get(help.group) ?? [];
    for (const entry of help.keys)
      if (!keys.some(([k]) => k === entry[0])) keys.push(entry);
    merged.set(help.group, keys);
  }
  helpSnapshot = [...merged].map(([group, keys]) => ({ group, keys }));
  for (const listener of helpListeners) listener();
}

/** The help groups of every mounted, enabled registration. */
export function useActiveShortcutHelp(): ShortcutHelp[] {
  return useSyncExternalStore(
    (listener) => {
      helpListeners.add(listener);
      return () => helpListeners.delete(listener);
    },
    () => helpSnapshot,
    () => helpSnapshot,
  );
}
let pending: string | null = null;
let pendingTimer = 0;

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
      ),
    )
  );
}

/** Enter and Space on a focused link or button belong to that control. */
export function isOnControl(event: KeyboardEvent): boolean {
  return (
    event.target instanceof HTMLElement &&
    event.target.closest("a, button, summary, [role='button']") !== null
  );
}

// Priority first, fallback last, everything else between in insertion order
// (Array.sort is stable).
function rank(ref: Registration) {
  const options = registrationOptions.get(ref);
  return options?.priority ? -1 : options?.fallback ? 1 : 0;
}

function clearSequence() {
  pending = null;
  window.clearTimeout(pendingTimer);
}

// One dispatcher makes navigation sequences win over page shortcuts regardless
// of React effect order (g h must never highlight the current paragraph).
function onKeyDown(event: KeyboardEvent) {
  // Browser automation and some input methods emit non-key events; these
  // must not consume an in-progress navigation sequence.
  if (event.key === "Unidentified" || event.key === "Dead") return;
  if (
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    isTypingTarget(event.target)
  ) {
    clearSequence();
    return;
  }
  if (
    document.querySelector(
      "dialog[open], [aria-modal='true'], [data-radix-popper-content-wrapper]",
    ) ||
    (event.target instanceof HTMLElement &&
      event.target.closest("[role='dialog'], [role='menu']"))
  ) {
    clearSequence();
    return;
  }
  const maps = [...registrations]
    .sort((a, b) => rank(a) - rank(b))
    .map((ref) => ref.current);
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (
    document.documentElement.dataset.keyboardShortcuts === "off" &&
    key !== "?" &&
    key !== "Escape"
  ) {
    clearSequence();
    return;
  }
  // The first registration that doesn't decline the key takes it.
  const run = (name: string) => {
    for (const map of maps) {
      const handler = map[name];
      if (handler && handler(event) !== false) {
        event.preventDefault();
        return true;
      }
    }
    return false;
  };
  if (pending) {
    const sequence = `${pending} ${key}`;
    clearSequence();
    if (maps.some((map) => map[sequence]) && run(sequence)) return;
  }
  if (
    maps.some((map) =>
      Object.keys(map).some((keyName) => keyName.startsWith(`${key} `)),
    )
  ) {
    event.preventDefault();
    pending = key;
    pendingTimer = window.setTimeout(clearSequence, 1200);
    return;
  }
  run(key);
}

export function useShortcuts(
  map: ShortcutMap,
  enabled = true,
  options: ShortcutOptions = {},
) {
  const ref = useRef(map);
  ref.current = map;
  // The sheet content is static per call site, so its text is the dependency
  const helpKey = options.help ? JSON.stringify(options.help) : "";
  const fallback = Boolean(options.fallback);
  const priority = Boolean(options.priority);
  useEffect(() => {
    if (!enabled) return;
    return registerShortcuts(ref, {
      help: helpKey ? JSON.parse(helpKey) : undefined,
      fallback,
      priority,
    });
  }, [enabled, helpKey, fallback, priority]);
}

/** Shared registration also used by the dispatcher regression tests. */
export function registerShortcuts(
  ref: { current: ShortcutMap },
  options: ShortcutOptions = {},
) {
  registrations.add(ref);
  registrationOptions.set(ref, options);
  publishHelp();
  if (registrations.size === 1) {
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", clearSequence);
  }
  return () => {
    registrations.delete(ref);
    publishHelp();
    clearSequence();
    if (!registrations.size) {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", clearSequence);
    }
  };
}

type Command =
  | "open-settings"
  | "toggle-summary"
  | "open-shortcuts"
  | "open-finder";
export function emitCommand(name: Command) {
  document.dispatchEvent(new CustomEvent(`marginalia:${name}`));
}
export function useCommand(name: Command, handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = () => ref.current();
    document.addEventListener(`marginalia:${name}`, listener);
    return () => document.removeEventListener(`marginalia:${name}`, listener);
  }, [name]);
}

export function moveFocus(items: HTMLElement[], direction: 1 | -1) {
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    index === -1
      ? direction === 1
        ? 0
        : items.length - 1
      : Math.min(items.length - 1, Math.max(0, index + direction));
  items[next].focus({ preventScroll: true });
}
