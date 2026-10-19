// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiscoveryInvalidation } from "./discovery-invalidation";
import { discoveryTabs } from "./test/discovery-tabs";

afterEach(() => vi.unstubAllGlobals());

describe("discovery invalidation transport", () => {
  it.each([
    "blocked",
    "unsupported",
  ] as const)("delivers between two storage-only tabs with %s channels", async (mode) => {
    const tabs = discoveryTabs(mode);
    const local = createDiscoveryInvalidation();
    const a = vi.fn();
    const b = vi.fn();
    const offA = local.subscribe(a);
    const offB = tabs.remote.subscribe(b);
    local.publish();
    await Promise.resolve();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(tabs.sent).toHaveLength(0);
    expect(window.localStorage.length).toBe(0);
    offA();
    offB();
    tabs.close();
  });
  it("delivers locally once and to another tab without echoes or private data", async () => {
    const tabs = discoveryTabs();
    const local = createDiscoveryInvalidation();
    const a = vi.fn();
    const b = vi.fn();
    const offA = local.subscribe(a);
    const offB = tabs.remote.subscribe(b);
    local.publish();
    await Promise.resolve();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(tabs.sent).toHaveLength(1);
    expect(tabs.sent[0]).toEqual({
      version: 1,
      type: "library-edited",
      id: expect.stringMatching(/^[a-z0-9-]{1,80}$/),
    });
    // A storage duplicate of the same delivery does not invalidate twice.
    tabs.remoteWindow.dispatchEvent(
      new StorageEvent("storage", {
        key: "marginalia:discovery-invalidation",
        newValue: JSON.stringify(tabs.sent[0]),
      }),
    );
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
    expect(tabs.endpoints.size).toBe(0);
    tabs.close();
  });

  it("ignores malformed/versioned/oversized foreign messages and cleans up", () => {
    const signal = createDiscoveryInvalidation();
    const listener = vi.fn();
    const off = signal.subscribe(listener);
    for (const value of [
      null,
      [],
      { version: 2, type: "library-edited", id: "x" },
      { version: 1, type: "library-edited", id: "x", query: "private" },
      { version: 1, type: "foreign", id: "x" },
      { version: 1, type: "library-edited", id: {} },
      "x".repeat(201),
    ]) {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "marginalia:discovery-invalidation",
          newValue: JSON.stringify(value),
        }),
      );
    }
    expect(listener).not.toHaveBeenCalled();
    off();
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "marginalia:discovery-invalidation",
        newValue: JSON.stringify({
          version: 1,
          type: "library-edited",
          id: "valid",
        }),
      }),
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it("falls back to storage when the channel is blocked and tolerates blocked storage/SSR", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new Error("blocked");
        }
      },
    );
    const signal = createDiscoveryInvalidation();
    const listener = vi.fn();
    const off = signal.subscribe(listener);
    vi.stubGlobal("localStorage", {
      setItem() {
        throw new Error("blocked");
      },
    });
    expect(() => signal.publish()).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "marginalia:discovery-invalidation",
        newValue: JSON.stringify({
          version: 1,
          type: "library-edited",
          id: "remote",
        }),
      }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    const ssr = createDiscoveryInvalidation(() => undefined);
    const ssrListener = vi.fn();
    const stop = ssr.subscribe(ssrListener);
    expect(() => ssr.publish()).not.toThrow();
    expect(ssrListener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("shares one channel per endpoint, closes on pagehide and restores on pageshow", () => {
    const tabs = discoveryTabs();
    const local = createDiscoveryInvalidation();
    const off = local.subscribe(vi.fn());
    const off2 = local.subscribe(vi.fn());
    expect(tabs.endpoints.size).toBe(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(tabs.endpoints.size).toBe(0);
    window.dispatchEvent(new Event("pageshow"));
    expect(tabs.endpoints.size).toBe(1);
    off();
    expect(tabs.endpoints.size).toBe(1);
    off2();
    expect(tabs.endpoints.size).toBe(0);
    tabs.close();
  });
});
