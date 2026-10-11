"use client";
import { useEffect, useRef } from "react";

export type ShortcutHandler = (event: KeyboardEvent) => void;
export type ShortcutMap = Record<string, ShortcutHandler>;

const registrations = new Set<{ current: ShortcutMap }>();
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
  const maps = [...registrations].map((ref) => ref.current);
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (
    document.documentElement.dataset.keyboardShortcuts === "off" &&
    key !== "?" &&
    key !== "Escape"
  ) {
    clearSequence();
    return;
  }
  const find = (key: string) => maps.find((map) => map[key])?.[key];
  if (pending) {
    const handler = find(`${pending} ${key}`);
    clearSequence();
    if (handler) {
      event.preventDefault();
      handler(event);
      return;
    }
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
  const handler = find(key);
  if (handler) {
    // Don't steal Space/Enter, arrow keys or other native control behaviors.
    event.preventDefault();
    handler(event);
  }
}

export function useShortcuts(map: ShortcutMap, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    return registerShortcuts(ref);
  }, [enabled]);
}

/** Shared registration also used by the dispatcher regression tests. */
export function registerShortcuts(ref: { current: ShortcutMap }) {
  registrations.add(ref);
  if (registrations.size === 1) {
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", clearSequence);
  }
  return () => {
    registrations.delete(ref);
    clearSequence();
    if (!registrations.size) {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", clearSequence);
    }
  };
}

type Command = "open-settings" | "toggle-summary" | "open-shortcuts";
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
