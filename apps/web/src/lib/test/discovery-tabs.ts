import { vi } from "vitest";
import { createDiscoveryInvalidation } from "../discovery-invalidation";

/** Native EventTargets, separate endpoints, queued delivery, never self-delivery. */
export function discoveryTabs(
  channel: "available" | "blocked" | "unsupported" = "available",
) {
  const endpoints = new Set<Channel>();
  const sent: unknown[] = [];
  class Channel extends EventTarget {
    constructor(readonly name: string) {
      super();
      endpoints.add(this);
    }
    postMessage(data: unknown) {
      sent.push(structuredClone(data));
      for (const endpoint of endpoints) {
        if (endpoint !== this && endpoint.name === this.name)
          queueMicrotask(() => {
            if (endpoints.has(endpoint))
              endpoint.dispatchEvent(
                new MessageEvent("message", { data: structuredClone(data) }),
              );
          });
      }
    }
    close() {
      endpoints.delete(this);
    }
  }
  const frame = document.body.appendChild(document.createElement("iframe"));
  const remoteWindow = frame.contentWindow;
  if (!remoteWindow) throw new Error("Missing second tab window");
  const channelConstructor =
    channel === "available"
      ? Channel
      : channel === "blocked"
        ? class {
            constructor() {
              throw new Error("Channel blocked");
            }
          }
        : undefined;
  vi.stubGlobal("BroadcastChannel", channelConstructor);
  Object.defineProperty(remoteWindow, "BroadcastChannel", {
    value: channelConstructor,
  });
  const values = new Map<string, string>();
  const storage = (target: Window): Storage => ({
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      const oldValue = values.get(key) ?? null;
      values.set(key, value);
      queueMicrotask(() =>
        target.dispatchEvent(
          new StorageEvent("storage", { key, oldValue, newValue: value }),
        ),
      );
    },
    removeItem(key) {
      const oldValue = values.get(key) ?? null;
      values.delete(key);
      queueMicrotask(() =>
        target.dispatchEvent(
          new StorageEvent("storage", { key, oldValue, newValue: null }),
        ),
      );
    },
    clear: () => values.clear(),
  });
  vi.stubGlobal("localStorage", storage(remoteWindow));
  Object.defineProperty(remoteWindow, "localStorage", {
    value: storage(window),
  });
  const remote = createDiscoveryInvalidation(() => remoteWindow);
  return {
    remote,
    remoteWindow,
    sent,
    endpoints,
    close: () => frame.remove(),
  };
}
