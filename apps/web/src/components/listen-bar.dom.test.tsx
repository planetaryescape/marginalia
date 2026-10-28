// @vitest-environment happy-dom
import { ConvexError } from "convex/values";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useListen } from "@/lib/reading-modes";
import type { ListenStatus } from "@/lib/use-natural-voice";
import { ListenBar, SLOW_WAIT_MS } from "./listen-bar";

vi.mock("convex/react", () => ({
  useQuery: () => ({ providers: ["openrouter"] }),
}));

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="mount"></div>';
  root = createRoot(document.getElementById("mount") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const noop = () => undefined;
function Bar(props: Partial<Parameters<typeof ListenBar>[0]> = {}) {
  return (
    <ListenBar
      status="playing"
      index={11}
      total={24}
      error={null}
      needsKey={false}
      deviceSupported
      onTogglePause={noop}
      onPrevious={noop}
      onNext={noop}
      onStop={noop}
      onRetry={noop}
      onUseDeviceVoice={noop}
      {...props}
    />
  );
}
const render = (props?: Parameters<typeof Bar>[0]) =>
  act(async () => root.render(<Bar {...props} />));
const note = () => document.querySelector(".listen-pencil") as HTMLElement;
const dot = () => document.querySelector(".listen-dot") as HTMLElement;
const wrap = () => document.querySelector(".listen-wrap") as HTMLElement;
const elapse = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it("shows nothing until a listen opens it", async () => {
  await render({ status: "idle", index: null });
  expect(document.querySelector(".listen-pill")).toBeNull();
});

it("shows the paragraph count with its total, one dot, and the controls", async () => {
  await render();
  expect(document.querySelector(".listen-count")?.textContent).toBe("¶12/24");
  expect(
    document.querySelector('[aria-label="Paragraph 12 of 24"]'),
  ).not.toBeNull();
  expect(wrap().hasAttribute("data-open")).toBe(true);
  expect(document.querySelectorAll(".listen-dot")).toHaveLength(1);
  expect(dot().dataset.mode).toBe("playing");
  for (const name of [
    "Previous paragraph",
    "Pause",
    "Next paragraph",
    "Stop listening",
  ])
    expect(document.querySelector(`[aria-label="${name}"]`)).not.toBeNull();
  expect(
    document
      .querySelector('[aria-label="Pause"]')
      ?.hasAttribute("data-primary"),
  ).toBe(true);
});

it("moves the dot between breathing and dim, and offers Resume when paused", async () => {
  await render({ status: "preparing" });
  expect(dot().dataset.mode).toBe("preparing");
  await render({ status: "paused" });
  expect(dot().dataset.mode).toBe("paused");
  expect(document.querySelector('[aria-label="Resume"]')).not.toBeNull();
});

it("says Paused while paused, so the state is more than a dimmer dot", async () => {
  const label = () => document.querySelector(".listen-label")?.textContent;
  await render({ status: "playing" });
  expect(label()).toBe("Listening");
  await render({ status: "paused" });
  expect(label()).toBe("Paused");
});

it("lets Previous be pressed at the first paragraph, where it restarts it or goes back to the title", async () => {
  const onPrevious = vi.fn();
  await render({ index: 0, onPrevious });
  const button = document.querySelector(
    '[aria-label="Previous paragraph"]',
  ) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(onPrevious).toHaveBeenCalledTimes(1);
});

it("writes the slow-wait line after 4 s of preparing, and takes it back when the voice plays", async () => {
  await render({ status: "preparing" });
  expect(note().hasAttribute("data-show")).toBe(false);
  await elapse(SLOW_WAIT_MS - 1);
  expect(note().hasAttribute("data-show")).toBe(false);
  await elapse(2);
  expect(note().hasAttribute("data-show")).toBe(true);
  expect(note().textContent).toBe("Still preparing this paragraph.");
  expect(note().getAttribute("role")).toBe("status");
  await render({ status: "playing" });
  expect(note().hasAttribute("data-show")).toBe(false);
});

it("starts the 4 s again for each paragraph, and not while paused or failed", async () => {
  await render({ status: "preparing", index: 3 });
  await elapse(3000);
  await render({ status: "preparing", index: 4 });
  await elapse(3000);
  expect(note().hasAttribute("data-show")).toBe(false);
  await elapse(1100);
  expect(note().hasAttribute("data-show")).toBe(true);
  await render({ status: "paused", index: 4 });
  await elapse(5000);
  expect(note().hasAttribute("data-show")).toBe(false);
  await render({ status: "failed", error: "Rate limited." });
  await elapse(5000);
  expect(note().hasAttribute("data-show")).toBe(false);
});

it("shows the failure sentence as an alert with a terracotta dot, Retry and Stop", async () => {
  const onRetry = vi.fn();
  const onStop = vi.fn();
  await render({
    status: "failed",
    error: "The voice stopped: OpenRouter didn't answer.",
    onRetry,
    onStop,
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "The voice stopped: OpenRouter didn't answer.",
  );
  expect(dot().dataset.mode).toBe("failed");
  expect(document.querySelector(".listen-count")).toBeNull();
  await act(async () =>
    (document.querySelector(".listen-link") as HTMLElement).click(),
  );
  await act(async () =>
    (
      document.querySelector('[aria-label="Stop listening"]') as HTMLElement
    ).click(),
  );
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(onStop).toHaveBeenCalledTimes(1);
});

it("shows the no-key choices with no dot, and Dismiss", async () => {
  const onUse = vi.fn();
  await render({
    needsKey: true,
    status: "idle",
    index: null,
    onUseDeviceVoice: onUse,
  });
  expect(document.querySelector('a[href="/account"]')?.textContent).toBe(
    "Natural voice: add an OpenRouter key",
  );
  expect(dot().dataset.mode).toBe("none");
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent === "Use device voice")
      ?.click(),
  );
  expect(onUse).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[aria-label="Dismiss"]')).not.toBeNull();
});

it("leaves out the device voice where the browser has none", async () => {
  await render({
    needsKey: true,
    status: "idle",
    index: null,
    deviceSupported: false,
  });
  expect(document.body.textContent).not.toContain("Use device voice");
});

it("sinks away when finished and keeps what it last said while it goes", async () => {
  await render();
  await render({ status: "finished", index: null });
  expect(wrap().hasAttribute("data-open")).toBe(false);
  expect(document.querySelector(".listen-count")?.textContent).toBe("¶12/24");
});

// The whole way through: a ConvexError sentence from the clip source reaches the bar
class FakeAudio {
  src = "";
  currentTime = 0;
  preservesPitch = false;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute() {
    this.src = "";
  }
  addEventListener() {}
}

it("shows the sentence of a ConvexError from the voice, with Retry", async () => {
  vi.stubGlobal("Audio", FakeAudio);
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML =
    '<article><div data-article-body><p data-para="1">One plain paragraph here.</p></div></article><div id="mount"></div>';
  root = createRoot(document.getElementById("mount") as HTMLElement);
  const article = document.querySelector("article") as HTMLElement;
  const source = vi
    .fn()
    .mockRejectedValueOnce(
      new ConvexError("Your OpenRouter credit has run out."),
    )
    .mockReturnValue(new Promise(() => undefined));
  let listen: ReturnType<typeof useListen>;
  function Page() {
    listen = useListen({ current: article }, "a", "u", "c", "", source);
    return (
      <ListenBar
        status={listen.status as ListenStatus}
        index={listen.index}
        total={1}
        error={listen.error}
        needsKey={listen.needsKey}
        deviceSupported={listen.deviceSupported}
        onTogglePause={listen.togglePause}
        onPrevious={listen.previous}
        onNext={listen.next}
        onStop={listen.stop}
        onRetry={listen.retry}
        onUseDeviceVoice={listen.chooseDeviceVoice}
      />
    );
  }
  await act(async () => root.render(<Page />));
  await act(async () => listen.speakFrom(0));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Your OpenRouter credit has run out.",
  );
  await act(async () =>
    (document.querySelector(".listen-link") as HTMLElement).click(),
  );
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(source).toHaveBeenCalledTimes(2);
  expect(document.querySelector(".listen-count")?.textContent).toBe("¶1/1");
});
