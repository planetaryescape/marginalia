// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useListen } from "./reading-modes";
import type { ClipSource } from "./use-natural-voice";

vi.mock("convex/react", () => ({
  useQuery: () => ({ providers: ["openrouter"] }),
}));

// Like a browser, loading a new src puts playbackRate back to defaultPlaybackRate
class FakeAudio {
  static all: FakeAudio[] = [];
  currentTime = 0;
  preservesPitch = false;
  defaultPlaybackRate = 1;
  playbackRate = 1;
  private source = "";
  private handlers = new Map<string, Set<() => void>>();
  constructor() {
    FakeAudio.all.push(this);
  }
  get src() {
    return this.source;
  }
  set src(value: string) {
    this.source = value;
    this.playbackRate = this.defaultPlaybackRate;
  }
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute(name: string) {
    if (name === "src") this.source = "";
  }
  addEventListener(type: string, fn: () => void) {
    const set = this.handlers.get(type) ?? new Set();
    set.add(fn);
    this.handlers.set(type, set);
  }
  fire(type: string) {
    for (const fn of this.handlers.get(type) ?? []) fn();
  }
}

let resolvers: (() => void)[] = [];
const source: ClipSource = (text) =>
  new Promise<Blob>((resolve) => {
    resolvers.push(() => resolve(new Blob([text], { type: "audio/mpeg" })));
  });

let root: Root;
let article: HTMLElement;
let listen: ReturnType<typeof useListen>;
const speak = vi.fn();
class Utterance {
  rate = 1;
  constructor(public text: string) {}
}
const scrollTo = vi.fn();
let reduced = false;
const store = new Map<string, string>();

function Harness() {
  listen = useListen({ current: article }, "a1", "u1", "prose", "", source);
  return null;
}

function mountArticle(count = 6) {
  document.body.innerHTML = `<article><div data-article-body>${Array.from(
    { length: count },
    (_v, i) =>
      `<p data-para="${i + 1}">Paragraph ${i} says one plain thing.</p>`,
  ).join("")}</div></article><div id="mount"></div>`;
  article = document.querySelector("article") as HTMLElement;
  root = createRoot(document.getElementById("mount") as HTMLElement);
  // In view by default, so only a test that places a block out of view sees a scroll
  for (let i = 0; i < count; i++) place(i, 300);
}
const para = (n: number) =>
  article.querySelectorAll("[data-para]")[n] as HTMLElement;
/** Puts a paragraph's top at `top` px in the viewport. */
function place(n: number, top: number, height = 80) {
  para(n).getBoundingClientRect = () =>
    ({ top, bottom: top + height, height }) as DOMRect;
}
const audio = () => FakeAudio.all[0];
const render = () => act(async () => root.render(<Harness />));
const start = (block: number) => act(async () => listen.speakFrom(block));
const settle = (n: number) => act(async () => resolvers[n]());
const ended = () => act(async () => audio().fire("ended"));
const elapse = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const scrollEnd = () =>
  act(async () => {
    window.dispatchEvent(new Event("scrollend"));
  });
const scrollByUser = () =>
  act(async () => {
    window.dispatchEvent(new Event("scroll"));
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    speak,
    cancel: vi.fn(),
    getVoices: () => [],
  });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  FakeAudio.all = [];
  resolvers = [];
  store.clear();
  reduced = false;
  speak.mockClear();
  // Our own scroll raises a scroll event, as a browser's does
  scrollTo.mockReset().mockImplementation(() => {
    window.dispatchEvent(new Event("scroll"));
  });
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  window.sessionStorage.clear();
  URL.createObjectURL = () => `blob:${Math.random()}`;
  URL.revokeObjectURL = () => undefined;
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers();
});
afterEach(async () => {
  await act(async () => root.unmount());
  await act(async () => {
    for (const resolve of resolvers) resolve();
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("speed", () => {
  it("starts at 1x and applies a new speed to the clip already playing", async () => {
    mountArticle();
    await render();
    expect(listen.speed).toBe(1);
    await start(0);
    await settle(0);
    expect(audio().playbackRate).toBe(1);
    await act(async () => listen.setSpeed(1.5));
    expect(listen.speed).toBe(1.5);
    expect(audio().playbackRate).toBe(1.5);
    expect(audio().preservesPitch).toBe(true);
  });

  it("carries the speed to the next clip even though loading a src resets the rate", async () => {
    mountArticle();
    await render();
    await start(0);
    await settle(0);
    await act(async () => listen.setSpeed(1.75));
    await settle(1);
    await ended();
    await elapse(400);
    expect(audio().src).not.toBe("");
    expect(audio().playbackRate).toBe(1.75);
  });

  it("applies the speed to a listen that starts after it was set", async () => {
    mountArticle();
    await render();
    await act(async () => listen.setSpeed(1.2));
    await start(0);
    await settle(0);
    expect(audio().playbackRate).toBe(1.2);
  });

  it("clamps to 0.8 to 2 on the 0.05 grid", async () => {
    mountArticle();
    await render();
    await act(async () => listen.setSpeed(5));
    expect(listen.speed).toBe(2);
    await act(async () => listen.setSpeed(0.1));
    expect(listen.speed).toBe(0.8);
    await act(async () => listen.setSpeed(1.23));
    expect(listen.speed).toBe(1.25);
  });

  it("is kept with the other reader settings in the browser, and read back next time", async () => {
    mountArticle();
    await render();
    await act(async () => listen.setSpeed(1.5));
    expect(store.get("marginalia.listenSpeed")).toBe("1.5");
    await act(async () => root.unmount());
    root = createRoot(document.getElementById("mount") as HTMLElement);
    await render();
    expect(listen.speed).toBe(1.5);
  });

  it("falls back to 1x from a bad stored value, and still works when storage is blocked", async () => {
    store.set("marginalia.listenSpeed", "fast");
    mountArticle();
    await render();
    expect(listen.speed).toBe(1);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    await act(async () => listen.setSpeed(1.2));
    expect(listen.speed).toBe(1.2);
  });

  it("shortens the gap between paragraphs with the speed", async () => {
    mountArticle();
    await render();
    await act(async () => listen.setSpeed(2));
    await start(0);
    await settle(0);
    await ended();
    expect(listen.status).toBe("gap");
    await elapse(170);
    expect(listen.status).toBe("gap");
    await elapse(10);
    expect(listen.status).not.toBe("gap");
  });

  it("gives the device voice the speed from the next paragraph", async () => {
    window.sessionStorage.setItem("marginalia.listenVoice", "device");
    mountArticle();
    await render();
    await act(async () => listen.setSpeed(1.5));
    await start(0);
    expect((speak.mock.calls[0][0] as Utterance).rate).toBe(1.5);
  });
});

describe("following", () => {
  it("follows at the start, and a scroll the player makes itself doesn't end it", async () => {
    mountArticle();
    place(2, 2000);
    await render();
    await start(2);
    expect(listen.following).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(listen.following).toBe(true);
  });

  it("brings the block to the reading line, instantly when the reader prefers reduced motion", async () => {
    reduced = true;
    mountArticle();
    place(1, 1500, 80);
    await render();
    await start(1);
    const call = scrollTo.mock.calls[0][0] as ScrollToOptions;
    expect(call.behavior).toBe("instant");
    // The block's middle lands 40% down the viewport
    expect(call.top).toBe(1500 + 40 - window.innerHeight * 0.4);
  });

  it("eases the scroll when motion is welcome", async () => {
    mountArticle();
    place(1, 1500);
    await render();
    await start(1);
    expect((scrollTo.mock.calls[0][0] as ScrollToOptions).behavior).toBe(
      "smooth",
    );
  });

  it("leaves a block that is already in view where it is", async () => {
    mountArticle();
    place(1, 300);
    await render();
    await start(1);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls at most once per block", async () => {
    mountArticle();
    place(1, 1500);
    await render();
    await start(1);
    await settle(0);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("a scroll of the reader's own ends following, and the player stops scrolling", async () => {
    mountArticle();
    place(0, 300);
    place(1, 2000);
    await render();
    await start(0);
    await settle(0);
    await scrollByUser();
    expect(listen.following).toBe(false);
    await settle(1);
    await ended();
    await elapse(400);
    expect(listen.index).toBe(1);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("treats a wheel or a touch as the reader's even in the middle of its own scroll", async () => {
    mountArticle();
    place(0, 2000);
    await render();
    await start(0);
    // Our scroll is under way, so a plain scroll event would be ignored
    await act(async () => {
      window.dispatchEvent(new Event("wheel"));
    });
    expect(listen.following).toBe(false);
    await start(0);
    expect(listen.following).toBe(true);
    await act(async () => {
      window.dispatchEvent(new Event("touchmove"));
    });
    expect(listen.following).toBe(false);
  });

  it("counts the reader's scroll again once our own has ended", async () => {
    mountArticle();
    place(0, 2000);
    await render();
    await start(0);
    await act(async () => {
      window.dispatchEvent(new Event("scrollend"));
    });
    await scrollByUser();
    expect(listen.following).toBe(false);
  });

  it("stops expecting its own scroll's end after a second, where scrollend isn't supported", async () => {
    mountArticle();
    place(0, 2000);
    await render();
    await start(0);
    await elapse(1100);
    await scrollByUser();
    expect(listen.following).toBe(false);
  });

  it("Follow scrolls the speaking block to the reading line and follows again", async () => {
    mountArticle();
    place(0, 300);
    place(1, 300);
    place(2, 2000);
    await render();
    await start(0);
    await settle(0);
    await scrollByUser();
    expect(listen.following).toBe(false);
    // The reader has scrolled a long way down; the voice is still on paragraph 0
    place(0, -900);
    await act(async () => listen.follow());
    expect(listen.following).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect((scrollTo.mock.calls[0][0] as ScrollToOptions).top).toBe(0);

    // Following again, so the voice reaching a block out of view scrolls to it
    await act(async () => listen.next());
    await act(async () => listen.next());
    expect(listen.index).toBe(2);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("keeps not following across paragraph skips until Follow is pressed", async () => {
    mountArticle();
    place(0, 300);
    place(1, 2000);
    await render();
    await start(0);
    await scrollByUser();
    expect(listen.following).toBe(false);
    await act(async () => listen.next());
    expect(listen.following).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("follows again at the next listen, and stops watching the page when it ends", async () => {
    mountArticle();
    await render();
    await start(0);
    await scrollByUser();
    expect(listen.following).toBe(false);
    await act(async () => listen.stop());
    expect(listen.following).toBe(true);
    await start(0);
    expect(listen.following).toBe(true);
    await act(async () => listen.stop());
    await scrollByUser();
    expect(listen.following).toBe(true);
  });

  it("does the same for the device voice", async () => {
    window.sessionStorage.setItem("marginalia.listenVoice", "device");
    mountArticle();
    place(0, 2000);
    place(1, 2000);
    await render();
    await start(0);
    expect(listen.following).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await scrollEnd();
    await scrollByUser();
    expect(listen.following).toBe(false);
    // Skipping on the device voice doesn't quietly follow again
    await act(async () => listen.next());
    expect(listen.following).toBe(false);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await act(async () => listen.follow());
    expect(listen.following).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
});
