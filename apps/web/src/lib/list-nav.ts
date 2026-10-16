"use client";
import { type ShortcutMap, useShortcuts } from "@/lib/shortcuts";

/**
 * Lists mark their focusable entry points with `data-nav-item`. A row that
 * also carries actions wraps item and actions in `data-nav-row`, and each
 * action is a real button marked `data-nav-action="<name>"`. The keys only
 * click those buttons, so the pointer and the keyboard share one code path.
 */
const ITEM = "[data-nav-item]";
const ROW = "[data-nav-row]";

export function navItems(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ITEM)).filter(
    (el) => !el.closest("[hidden], [inert]"),
  );
}

function focusedItem(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  return active.closest<HTMLElement>(ITEM) ?? null;
}

function focusItem(el: HTMLElement) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest" });
}

/** Moves to the neighbouring item; with none focused, the first one. */
export function stepNav(direction: 1 | -1): boolean {
  const items = navItems();
  if (!items.length) return false;
  const current = focusedItem();
  const index = current ? items.indexOf(current) : -1;
  const next =
    index === -1
      ? 0
      : Math.min(items.length - 1, Math.max(0, index + direction));
  focusItem(items[next]);
  return true;
}

/**
 * Clicks a row's named action. When the row is about to leave the list (an
 * archive), focus goes to its neighbour first so it is never dropped on <body>.
 */
export function runRowAction(name: string, { leaves = false } = {}): boolean {
  const item = focusedItem();
  const row = item?.closest<HTMLElement>(ROW) ?? item;
  const button = row?.querySelector<HTMLElement>(`[data-nav-action="${name}"]`);
  if (!item || !button || button.matches(":disabled")) return false;
  if (leaves) {
    const items = navItems();
    const at = items.indexOf(item);
    const neighbour = items[at + 1] ?? items[at - 1];
    if (neighbour) focusItem(neighbour);
  }
  button.click();
  return true;
}

/** Enter on a row that isn't itself a link or button moves into its controls. */
function enterRow(event: KeyboardEvent): false | undefined {
  const item = focusedItem();
  if (!item || event.target !== item || item.matches("a, button")) return false;
  const inner = item.closest<HTMLElement>(ROW) ?? item;
  const control = inner.querySelector<HTMLElement>(
    "a[href], button:not(:disabled)",
  );
  if (!control) return false;
  control.focus();
}

export type RowActions = Record<
  string,
  { action: string; leaves?: boolean } | (() => boolean | undefined)
>;

/**
 * j/k and the arrows move through `data-nav-item`s. The arrows only act once
 * focus is on an item, so they keep scrolling the page until then.
 */
export function useListKeys(
  actions: RowActions = {},
  help: [string, string][] = [],
  enabled = true,
  group = "In this list",
) {
  const extra: ShortcutMap = {};
  for (const [key, spec] of Object.entries(actions)) {
    extra[key] =
      typeof spec === "function"
        ? () => (spec() ? undefined : false)
        : () =>
            runRowAction(spec.action, { leaves: spec.leaves })
              ? undefined
              : false;
  }
  useShortcuts(
    {
      j: () => (stepNav(1) ? undefined : false),
      k: () => (stepNav(-1) ? undefined : false),
      ArrowDown: () => (focusedItem() && stepNav(1) ? undefined : false),
      ArrowUp: () => (focusedItem() && stepNav(-1) ? undefined : false),
      Enter: enterRow,
      ...extra,
    },
    enabled,
    {
      help: {
        group,
        keys: [
          ["j  k", "Next and previous item (arrows too)"],
          ["Enter", "Open the item"],
          ...help,
        ],
      },
    },
  );
}

/**
 * `[` and `]` switch tabs from anywhere on the page; ← and → do the same once
 * focus is on the tab strip or nothing is focused, so they never fight a
 * control that uses the arrows itself. The tab strip is a `data-nav-tabs`
 * element of links; switching clicks the next link, so its own `replace` and
 * `scroll` settings apply and the strip keeps one way of navigating.
 */
export function useTabKeys<T extends { id: string; href: string }>(
  tabs: readonly T[],
  currentId: string,
) {
  const go = (direction: 1 | -1) => {
    const index = tabs.findIndex((tab) => tab.id === currentId);
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    if (!next || next.id === currentId) return false;
    const link = Array.from(
      document.querySelectorAll<HTMLElement>("[data-nav-tabs] a[href]"),
    ).find((el) => el.getAttribute("href") === next.href);
    if (!link) return false;
    link.click();
  };
  const arrow = (direction: 1 | -1) => {
    const active = document.activeElement;
    const free =
      !active ||
      active === document.body ||
      active.closest("[data-nav-tabs]") !== null;
    return free ? go(direction) : false;
  };
  useShortcuts(
    {
      "[": () => go(-1),
      "]": () => go(1),
      ArrowLeft: () => arrow(-1),
      ArrowRight: () => arrow(1),
    },
    tabs.length > 1,
    {
      help: {
        group: "Tabs",
        keys: [["[  ]", "Previous and next tab (arrows too)"]],
      },
    },
  );
}
