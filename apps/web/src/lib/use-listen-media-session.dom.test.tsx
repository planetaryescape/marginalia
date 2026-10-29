// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useListenMediaSession } from "./use-listen-media-session";
import type { ListenStatus } from "./use-natural-voice";

type Handler = (() => void) | null;
let handlers: Map<string, Handler>;
let session: {
  metadata: unknown;
  playbackState: string;
  setActionHandler: (action: string, handler: Handler) => void;
};

class FakeMetadata {
  constructor(public init: Record<string, unknown>) {}
}

const controls = {
  togglePause: vi.fn(),
  previous: vi.fn(),
  next: vi.fn(),
  stop: vi.fn(),
};

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("MediaMetadata", FakeMetadata);
  handlers = new Map();
  session = {
    metadata: null,
    playbackState: "none",
    setActionHandler: (action, handler) => {
      // Like Safari, which has no seek-by-offset buttons
      if (action === "seekforward") throw new TypeError("unsupported");
      handlers.set(action, handler);
    },
  };
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: session,
  });
  for (const fn of Object.values(controls)) fn.mockClear();
  document.body.innerHTML = '<div id="mount"></div>';
  root = createRoot(document.getElementById("mount") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function Harness({
  status,
  imageUrl,
}: {
  status: ListenStatus;
  imageUrl?: string;
}) {
  useListenMediaSession(
    { ...controls, status, active: !["idle", "finished"].includes(status) },
    {
      title: "On walking",
      author: null,
      url: "https://example.com/walk",
      imageUrl,
    },
  );
  return null;
}
const render = (status: ListenStatus, imageUrl?: string) =>
  act(async () => root.render(<Harness status={status} imageUrl={imageUrl} />));

it("names the article and hands the media keys to the player while listening", async () => {
  await render("playing");
  expect((session.metadata as FakeMetadata).init).toMatchObject({
    title: "On walking",
    artist: "example.com",
    album: "Marginalia",
  });
  expect(session.playbackState).toBe("playing");
  handlers.get("nexttrack")?.();
  handlers.get("seekbackward")?.();
  handlers.get("stop")?.();
  expect(controls.next).toHaveBeenCalledTimes(1);
  expect(controls.previous).toHaveBeenCalledTimes(1);
  expect(controls.stop).toHaveBeenCalledTimes(1);
});

it("shows the article's image on the lock screen, and nothing when there is none or it isn't a web address", async () => {
  await render("playing", "https://example.com/cover.jpg");
  expect((session.metadata as FakeMetadata).init.artwork).toEqual([
    { src: "https://example.com/cover.jpg" },
  ]);
  await render("playing", "data:image/png;base64,AAAA");
  expect((session.metadata as FakeMetadata).init.artwork).toEqual([]);
  await render("playing");
  expect((session.metadata as FakeMetadata).init.artwork).toEqual([]);
});

it("pauses only when playing and plays only when paused, so a repeated key doesn't flip it back", async () => {
  await render("playing");
  handlers.get("play")?.();
  expect(controls.togglePause).not.toHaveBeenCalled();
  handlers.get("pause")?.();
  expect(controls.togglePause).toHaveBeenCalledTimes(1);
  await render("paused");
  expect(session.playbackState).toBe("paused");
  handlers.get("pause")?.();
  handlers.get("play")?.();
  expect(controls.togglePause).toHaveBeenCalledTimes(2);
});

it("clears the controls when the listen ends, so no dead player is left behind", async () => {
  await render("playing");
  await render("idle");
  expect(session.metadata).toBeNull();
  expect(session.playbackState).toBe("none");
  expect([...handlers.values()].every((handler) => handler === null)).toBe(
    true,
  );
});

it("registers nothing until Listen starts", async () => {
  await render("idle");
  expect(handlers.size).toBe(0);
  expect(session.metadata).toBeNull();
});
