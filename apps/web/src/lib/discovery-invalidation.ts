const CHANNEL = "marginalia:discovery-invalidation";
const STORAGE_KEY = CHANNEL;
const TYPE = "library-edited";

type DiscoveryBrowser = Pick<
  Window,
  "addEventListener" | "removeEventListener" | "localStorage"
> & {
  BroadcastChannel?: new (
    name: string,
  ) => Pick<BroadcastChannel, "addEventListener" | "postMessage" | "close">;
};

interface DiscoveryInvalidation {
  subscribe(listener: () => void): () => void;
  publish(): void;
}

function validMessage(value: unknown): value is {
  version: 1;
  type: typeof TYPE;
  id: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 3 &&
    "version" in value &&
    value.version === 1 &&
    "type" in value &&
    value.type === TYPE &&
    "id" in value &&
    typeof value.id === "string" &&
    /^[a-z0-9-]{1,80}$/.test(value.id)
  );
}

/** One transport per tab, shared by caches, never a React refresh signal. */
export function createDiscoveryInvalidation(
  browser: () => DiscoveryBrowser | undefined = () =>
    typeof window === "undefined" ? undefined : window,
): DiscoveryInvalidation {
  const listeners = new Set<() => void>();
  const seen = new Set<string>();
  let channel:
    | Pick<BroadcastChannel, "addEventListener" | "postMessage" | "close">
    | undefined;
  let active: DiscoveryBrowser | undefined;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const remember = (id: string) => {
    seen.add(id);
    if (seen.size > 32) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  };
  const receive = (value: unknown) => {
    if (!validMessage(value) || seen.has(value.id)) return;
    remember(value.id);
    notify();
  };
  const onMessage = (event: MessageEvent<unknown>) => receive(event.data);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key !== STORAGE_KEY ||
      !event.newValue ||
      event.newValue.length > 200
    )
      return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {
      // Foreign/malformed storage is not an invalidation.
    }
  };
  const suspend = () => {
    channel?.close();
    channel = undefined;
    // Frozen/BFCache pages can miss messages; never retain reusable entries or
    // accept pre-suspension writes when the page returns.
    notify();
  };
  const resume = () => {
    try {
      if (!active?.BroadcastChannel || channel) return;
      channel = new active.BroadcastChannel(CHANNEL);
      channel.addEventListener("message", onMessage);
    } catch {
      // Storage events still work when BroadcastChannel is unavailable/blocked.
    }
  };
  const start = () => {
    if (active) return;
    active = browser();
    if (!active) return;
    active.addEventListener("storage", onStorage);
    active.addEventListener("pagehide", suspend);
    active.addEventListener("pageshow", resume);
    resume();
  };
  const stop = () => {
    suspend();
    active?.removeEventListener("storage", onStorage);
    active?.removeEventListener("pagehide", suspend);
    active?.removeEventListener("pageshow", resume);
    active = undefined;
    seen.clear();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) stop();
      };
    },
    publish() {
      // Local saves must remain safe even with no browser or blocked storage.
      notify();
      start();
      const message = {
        version: 1,
        type: TYPE,
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      };
      remember(message.id);
      try {
        channel?.postMessage(message);
      } catch {
        // Fall through to storage without failing the successful save.
      }
      try {
        // Also covers tabs where only one transport is available. No reader ID,
        // query, content or credentials are persisted, and no history is kept.
        active?.localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
        active?.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Local invalidation and TTL remain available in restricted browsers.
      }
      if (!listeners.size) stop();
    },
  };
}

export const discoveryInvalidation = createDiscoveryInvalidation();
