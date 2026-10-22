// @vitest-environment happy-dom
import { ConvexError } from "convex/values";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useListen } from "./reading-modes";
import type { ClipSource } from "./use-natural-voice";

const query = vi.hoisted(() => ({
  value: { providers: ["openrouter"] } as { providers: string[] } | undefined,
}));
vi.mock("convex/react", () => ({ useQuery: () => query.value }));

class FakeAudio {
  static all: FakeAudio[] = [];
  src = "";
  currentTime = 0;
  preservesPitch = false;
  paused = true;
  private handlers = new Map<string, Set<() => void>>();
  // The MP3 header's duration is wrong, so the player must never read it
  get duration(): number {
    throw new Error("audio.duration was read");
  }
  constructor() {
    FakeAudio.all.push(this);
  }
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
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

interface Call {
  text: string;
  signal: AbortSignal;
  resolve: () => void;
  reject: (error: unknown) => void;
  settled: boolean;
  /** How many times the element had been asked to play when this was requested. */
  playsAtRequest: number;
}
let calls: Call[] = [];
let inFlight = 0;
let maxInFlight = 0;
const source: ClipSource = (text, signal) =>
  new Promise<Blob>((resolve, reject) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const call: Call = {
      text,
      signal,
      settled: false,
      playsAtRequest: FakeAudio.all[0]?.play.mock.calls.length ?? 0,
      resolve: () => {
        if (call.settled) return;
        call.settled = true;
        inFlight -= 1;
        resolve(new Blob([text], { type: "audio/mpeg" }));
      },
      reject: (error) => {
        if (call.settled) return;
        call.settled = true;
        inFlight -= 1;
        reject(error);
      },
    };
    calls.push(call);
  });

let urlCount = 0;
let created: string[] = [];
let revoked: string[] = [];
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

let root: Root;
let article: HTMLElement;
let listen: ReturnType<typeof useListen>;
const speak = vi.fn();
const cancel = vi.fn();
class Utterance {
  constructor(public text: string) {}
}

function Harness({
  content = "prose",
  clip = source,
  heading,
}: {
  content?: string;
  clip?: ClipSource;
  heading?: { title: string; author?: string | null };
}) {
  listen = useListen(
    { current: article },
    "a1",
    "u1",
    content,
    "",
    clip,
    heading,
  );
  return null;
}

const paragraphText = (n: number) => `Paragraph ${n} says one plain thing.`;
function mountArticle(paragraphs: string[], tags: string[] = []) {
  document.body.innerHTML = `<article><div data-article-body>${paragraphs
    .map((t, i) => {
      const tag = tags[i] ?? "p";
      return `<${tag} data-para="${i + 1}">${t}</${tag}>`;
    })
    .join("")}</div></article><div id="mount"></div>`;
  article = document.querySelector("article") as HTMLElement;
  root = createRoot(document.getElementById("mount") as HTMLElement);
}
const plain = (n = 8) => Array.from({ length: n }, (_v, i) => paragraphText(i));
const el = (n: number) => article.querySelectorAll("[data-para]")[n];
const audio = () => FakeAudio.all[0];
const speaking = () => article.querySelector("[data-speaking]");
const pending = () => article.querySelector("[data-speaking-pending]");
const start = (block: number) => act(async () => listen.speakFrom(block));
const settle = async (n: number) => {
  await act(async () => calls[n].resolve());
};
const ended = () => act(async () => audio().fire("ended"));
const elapse = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("speechSynthesis", { speak, cancel, getVoices: () => [] });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  FakeAudio.all = [];
  calls = [];
  inFlight = 0;
  maxInFlight = 0;
  urlCount = 0;
  created = [];
  revoked = [];
  URL.createObjectURL = () => {
    const url = `blob:clip-${++urlCount}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  query.value = { providers: ["openrouter"] };
  window.sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  speak.mockClear();
  cancel.mockClear();
  vi.useFakeTimers();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

describe("starting", () => {
  it("unlocks the element with a silent clip inside the gesture, before anything is awaited", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    act(() => {
      listen.speakFrom(0);
      expect(audio().play).toHaveBeenCalledTimes(1);
      expect(audio().src).toMatch(/^data:audio\/wav/);
    });
    expect(audio().preservesPitch).toBe(true);
    expect(calls[0].playsAtRequest).toBe(1);
  });

  it("starts at the block it is given, washes it while preparing and lights it only when the voice starts", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(3);
    expect(listen.status).toBe("preparing");
    expect(listen.active).toBe(true);
    expect(listen.index).toBe(3);
    expect(calls[0].text).toBe(paragraphText(3));
    expect(pending()).toBe(el(3));
    expect(speaking()).toBeNull();
    // The clip is made but not yet heard: nothing has moved
    expect(audio().play).toHaveBeenCalledTimes(1);

    await settle(0);
    expect(audio().src).toBe("blob:clip-1");
    expect(listen.status).toBe("playing");
    expect(speaking()).toBe(el(3));
    expect(pending()).toBeNull();
  });

  it("makes the first item the starting block's leading sentences, at most 300 characters", async () => {
    const sentences = Array.from(
      { length: 40 },
      (_v, i) => `This is sentence ${i} of a long opening paragraph.`,
    );
    mountArticle([paragraphText(0), sentences.join(" ")]);
    await act(async () => root.render(<Harness />));
    await start(1);
    expect(calls[0].text.length).toBeLessThanOrEqual(300);
    expect(calls[0].text.startsWith("This is sentence 0")).toBe(true);
    expect(calls[1].text.startsWith("This is sentence")).toBe(true);
    expect(`${calls[0].text} ${calls[1].text}`).toBe(
      sentences
        .join(" ")
        .slice(0, calls[0].text.length + 1 + calls[1].text.length),
    );
  });

  it("never reads audio.duration", async () => {
    mountArticle(plain(3));
    await act(async () => root.render(<Harness />));
    await start(0);
    await settle(0);
    await ended();
    await elapse(400);
    expect(listen.status).toBe("preparing");
  });
});

describe("fetching ahead", () => {
  it("asks for each item once, never more than two at a time, never more than three ahead", async () => {
    mountArticle(plain(8));
    await act(async () => root.render(<Harness />));
    await start(0);
    expect(calls).toHaveLength(2);

    const playedFirst = async (n: number) => {
      await settle(n);
    };
    await playedFirst(0);
    expect(calls.map((c) => c.text).slice(0, 3)).toEqual(
      [0, 1, 2].map(paragraphText),
    );
    // item 0 is playing, so 0..3 may be requested and 2 are in flight
    await settle(1);
    expect(calls).toHaveLength(4);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(calls.map((c) => c.text)).toEqual([0, 1, 2, 3].map(paragraphText));

    for (let item = 0; item < 7; item++) {
      for (const [n, call] of calls.entries())
        if (!call.settled) await settle(n);
      await ended();
      await elapse(400);
    }
    expect(new Set(calls.map((c) => c.text)).size).toBe(calls.length);
    expect(calls).toHaveLength(8);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("gives back object URLs two items behind the voice", async () => {
    mountArticle(plain(8));
    await act(async () => root.render(<Harness />));
    await start(0);
    for (let item = 0; item < 4; item++) {
      for (const [n, call] of calls.entries())
        if (!call.settled) await settle(n);
      if (item < 3) {
        await ended();
        await elapse(400);
      }
    }
    // The voice is on item 3: items 0 and 1 are two behind or more
    expect(revoked).toEqual(
      expect.arrayContaining(["blob:clip-1", "blob:clip-2"]),
    );
    expect(revoked).not.toContain(audio().src);
  });
});

describe("skipping while requests are out", () => {
  async function skippedTwice() {
    mountArticle(plain(8));
    await act(async () => root.render(<Harness />));
    await start(0);
    // Items 0 and 1 are out, so both slots are full
    expect(calls).toHaveLength(2);
    await act(async () => listen.next());
    await act(async () => listen.next());
    expect(listen.index).toBe(2);
    expect(listen.status).toBe("preparing");
    expect(calls).toHaveLength(2);
  }

  it("requests the item skipped to once a late clip behind the voice frees a slot, and plays it", async () => {
    await skippedTwice();
    await settle(0);
    expect(calls.map((c) => c.text)).toContain(paragraphText(2));
    const target = calls.findIndex((c) => c.text === paragraphText(2));
    await settle(target);
    expect(listen.status).toBe("playing");
    expect(speaking()).toBe(el(2));
    // The dropped clip made no object URL that is still held
    expect(created.length - revoked.length).toBeGreaterThan(0);
    expect(audio().src).toBe(created.at(-1));
  });

  it("does the same when the clip behind the voice fails", async () => {
    await skippedTwice();
    await act(async () => calls[0].reject(new ConvexError("Rate limited.")));
    expect(listen.status).toBe("preparing");
    const target = calls.findIndex((c) => c.text === paragraphText(2));
    expect(target).toBeGreaterThan(-1);
    await settle(target);
    expect(listen.status).toBe("playing");
    expect(speaking()).toBe(el(2));
  });

  it("skips forward twice and back once with requests still out", async () => {
    mountArticle(plain(8));
    await act(async () => root.render(<Harness />));
    await start(0);
    await act(async () => listen.next());
    await act(async () => listen.next());
    await act(async () => listen.previous());
    expect(listen.index).toBe(1);
    for (let n = 0; n < 8; n++) {
      for (const [k, call] of calls.entries())
        if (!call.settled) await settle(k);
      if (listen.status === "playing") break;
    }
    expect(listen.status).toBe("playing");
    expect(speaking()).toBe(el(1));
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe("the title", () => {
  const heading = { title: "A Plain Title", author: "Ann Author" };

  it("opens a listen from the top with the title and author, without lighting a paragraph", async () => {
    mountArticle(plain(3));
    await act(async () => root.render(<Harness heading={heading} />));
    await start(0);
    expect(calls[0].text).toBe("A Plain Title. By Ann Author.");
    expect(calls[1].text).toBe(paragraphText(0));
    expect(pending()).toBeNull();
    await settle(0);
    expect(listen.status).toBe("playing");
    expect(listen.active).toBe(true);
    expect(speaking()).toBeNull();
    expect(pending()).toBeNull();

    await settle(1);
    await ended();
    await elapse(699);
    expect(listen.status).toBe("gap");
    await elapse(2);
    expect(listen.status).toBe("playing");
    expect(speaking()).toBe(el(0));
  });

  it("says just the title when there is no author, and nothing extra from further down the page", async () => {
    mountArticle(plain(3));
    await act(async () =>
      root.render(<Harness heading={{ title: "Why now?" }} />),
    );
    await start(0);
    expect(calls[0].text).toBe("Why now?");
    await start(1);
    expect(calls.at(-2)?.text).not.toBe("Why now?");
    expect(calls.at(-1)?.text).toBe(paragraphText(2));
  });

  it("previous from the first paragraph goes back to the title", async () => {
    mountArticle(plain(3));
    await act(async () => root.render(<Harness heading={heading} />));
    await start(0);
    await settle(0);
    await settle(1);
    await act(async () => listen.next());
    expect(speaking()).toBe(el(0));
    await act(async () => listen.previous());
    expect(listen.status).toBe("playing");
    expect(speaking()).toBeNull();
    expect(audio().src).toBe("blob:clip-1");
  });
});

describe("stopping", () => {
  it("ignores a clip that arrives after Stop and makes no object URL for it", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(2);
    await act(async () => listen.stop());
    expect(calls[0].signal.aborted).toBe(true);
    const played = audio().play.mock.calls.length;
    await settle(0);
    await settle(1);
    expect(created).toEqual([]);
    expect(listen.status).toBe("idle");
    expect(audio().play.mock.calls.length).toBe(played);
    expect(speaking()).toBeNull();
    expect(pending()).toBeNull();
  });

  it("stops on a prose change, drops the highlight and ignores what was in flight", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(0);
    await settle(0);
    await settle(1);
    expect(speaking()).toBe(el(0));
    await act(async () => root.render(<Harness content="new prose" />));
    expect(listen.active).toBe(false);
    expect(speaking()).toBeNull();
    expect(audio().src).toBe("");
    expect(revoked.sort()).toEqual(created.sort());
    await settle(2).catch(() => undefined);
  });

  it("keeps playing through a re-render that changes nothing about the prose", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(0);
    await settle(0);
    await act(async () => root.render(<Harness />));
    expect(listen.status).toBe("playing");
  });

  it("cleans up on unmount: audio stopped, URLs revoked, highlight cleared", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(0);
    await settle(0);
    await settle(1);
    const element = audio();
    await act(async () => root.unmount());
    expect(element.pause).toHaveBeenCalled();
    expect(element.src).toBe("");
    expect(revoked.sort()).toEqual(created.sort());
    expect(speaking()).toBeNull();
    root = createRoot(document.getElementById("mount") as HTMLElement);
  });

  it("restarting abandons the old run's late clips", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(0);
    await start(4);
    await act(async () => calls[0].resolve());
    expect(created).toEqual([]);
    expect(listen.index).toBe(4);
    await act(async () => calls[2].resolve());
    expect(audio().src).toBe("blob:clip-1");
    expect(speaking()).toBe(el(4));
  });
});

describe("pausing and moving", () => {
  async function playing(blocks = plain()) {
    mountArticle(blocks);
    await act(async () => root.render(<Harness />));
    await start(0);
    await settle(0);
    await settle(1);
  }

  it("pauses and resumes mid-clip on the same clip", async () => {
    await playing();
    const src = audio().src;
    await act(async () => listen.togglePause());
    expect(listen.paused).toBe(true);
    expect(audio().pause).toHaveBeenCalled();
    expect(listen.active).toBe(true);
    await act(async () => listen.togglePause());
    expect(listen.status).toBe("playing");
    expect(audio().src).toBe(src);
    expect(audio().play).toHaveBeenCalledTimes(3);
  });

  it("holds a pause taken while a clip is still being made", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(0);
    await act(async () => listen.togglePause());
    expect(listen.status).toBe("paused");
    await settle(0);
    expect(listen.status).toBe("paused");
    expect(audio().src).toMatch(/^data:/);
    await act(async () => listen.togglePause());
    expect(audio().src).toBe("blob:clip-1");
    expect(listen.status).toBe("playing");
  });

  it("holds a pause taken in the gap and moves on when resumed", async () => {
    await playing();
    await ended();
    expect(listen.status).toBe("gap");
    await act(async () => listen.togglePause());
    await elapse(2000);
    expect(listen.status).toBe("paused");
    expect(speaking()).toBe(el(0));
    await act(async () => listen.togglePause());
    expect(listen.index).toBe(1);
  });

  it("goes next and previous by block, restarting a block that is more than 3 s in", async () => {
    await playing();
    await act(async () => listen.next());
    expect(listen.index).toBe(1);
    await settle(2);
    await act(async () => listen.next());
    expect(listen.index).toBe(2);
    audio().currentTime = 5;
    await act(async () => listen.previous());
    expect(listen.index).toBe(2);
    audio().currentTime = 1;
    await act(async () => listen.previous());
    expect(listen.index).toBe(1);
  });

  it("finishes when next is pressed on the last block", async () => {
    mountArticle(plain(2));
    await act(async () => root.render(<Harness />));
    await start(1);
    await settle(0);
    await act(async () => listen.next());
    expect(listen.status).toBe("finished");
    expect(listen.active).toBe(false);
    expect(speaking()).toBeNull();
  });

  it("keeps counting as active from preparing until the last clip ends, then finishes", async () => {
    mountArticle(plain(2));
    await act(async () => root.render(<Harness />));
    const seen: boolean[] = [];
    await start(0);
    seen.push(listen.active);
    await settle(0);
    await settle(1);
    seen.push(listen.active);
    await ended();
    await elapse(400);
    seen.push(listen.active);
    await ended();
    expect(seen).toEqual([true, true, true]);
    expect(listen.status).toBe("finished");
    expect(listen.active).toBe(false);
    expect(revoked.sort()).toEqual(created.sort());
  });
});

describe("stale audio events and promises", () => {
  it("doesn't mistake the silent unlock clip ending, or an ended after Stop, for a finished clip", async () => {
    mountArticle(plain(3));
    await act(async () => root.render(<Harness />));
    await start(0);
    await ended();
    expect(listen.status).toBe("preparing");
    await settle(0);
    await act(async () => listen.stop());
    await ended();
    await elapse(1000);
    expect(listen.status).toBe("idle");
    expect(calls.filter((c) => c.text === paragraphText(1))).toHaveLength(1);
  });

  it("doesn't announce playing for a play() that began before a pause", async () => {
    mountArticle(plain(3));
    await act(async () => root.render(<Harness />));
    await start(0);
    let started = () => {};
    audio().play.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          started = resolve;
        }),
    );
    await settle(0);
    await act(async () => listen.togglePause());
    expect(listen.status).toBe("paused");
    await act(async () => started());
    expect(listen.status).toBe("paused");
    expect(speaking()).toBeNull();
  });

  it("ignores the AbortError a pause causes in a pending play()", async () => {
    mountArticle(plain(3));
    await act(async () => root.render(<Harness />));
    await start(0);
    let abortIt = (_error: unknown) => {};
    audio().play.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          abortIt = reject;
        }),
    );
    await settle(0);
    await act(async () => listen.togglePause());
    await act(async () =>
      abortIt(new DOMException("interrupted by pause()", "AbortError")),
    );
    expect(listen.status).toBe("paused");
  });
});

describe("finishing", () => {
  it("fades the last highlight over 600 ms instead of dropping it, and clears the fade for the next listen", async () => {
    mountArticle(plain(2));
    await act(async () => root.render(<Harness />));
    await start(1);
    await settle(0);
    expect(speaking()).toBe(el(1));
    await ended();
    expect(listen.status).toBe("finished");
    expect(speaking()).toBeNull();
    expect(el(1).hasAttribute("data-fading")).toBe(true);
    await elapse(801);
    expect(el(1).hasAttribute("data-fading")).toBe(false);

    await start(1);
    await settle(calls.length - 1);
    await ended();
    expect(el(1).hasAttribute("data-fading")).toBe(true);
    await start(0);
    expect(el(1).hasAttribute("data-fading")).toBe(false);
  });
});

describe("gaps", () => {
  async function through(tags: string[], paragraphs = plain(3)) {
    mountArticle(paragraphs, tags);
    await act(async () => root.render(<Harness />));
    await start(0);
    await settle(0);
    await settle(1);
    await settle(2).catch(() => undefined);
  }

  it("waits 350 ms between blocks and moves the highlight when the next clip starts", async () => {
    await through([]);
    await ended();
    expect(listen.status).toBe("gap");
    expect(speaking()).toBe(el(0));
    await elapse(349);
    expect(listen.status).toBe("gap");
    await elapse(2);
    expect(listen.status).toBe("playing");
    expect(speaking()).toBe(el(1));
    expect(audio().src).toBe("blob:clip-2");
  });

  it("waits 700 ms after a heading", async () => {
    await through(["h2"]);
    await ended();
    await elapse(400);
    expect(listen.status).toBe("gap");
    await elapse(301);
    expect(listen.status).toBe("playing");
  });

  it("starts the next clip inside the ended handler when the page is hidden", async () => {
    await through([]);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => {
      audio().fire("ended");
      // Synchronously, before any timer or microtask
      expect(audio().src).toBe("blob:clip-2");
    });
    expect(listen.status).toBe("playing");
    vi.restoreAllMocks();
  });

  it("adds no gap between the parts of one block", async () => {
    const long = Array.from(
      { length: 40 },
      (_v, i) => `Sentence ${i} is here.`,
    ).join(" ");
    mountArticle([long, paragraphText(1)]);
    await act(async () => root.render(<Harness />));
    await start(0);
    await settle(0);
    await settle(1);
    expect(listen.index).toBe(0);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    await ended();
    expect(listen.status).toBe("playing");
    expect(listen.index).toBe(0);
    expect(speaking()).toBe(el(0));
    vi.restoreAllMocks();
  });
});

describe("failing", () => {
  it("shows the server's sentence, holds the highlight, never starts the device voice, and Retry continues", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(0);
    await act(async () =>
      calls[0].reject(new ConvexError("OpenRouter didn't answer.")),
    );
    expect(listen.status).toBe("failed");
    expect(listen.error).toBe("OpenRouter didn't answer.");
    expect(listen.active).toBe(true);
    expect(pending()).toBe(el(0));
    expect(speak).not.toHaveBeenCalled();
    expect(listen.mode).toBe("natural");

    const before = calls.length;
    await act(async () => listen.retry());
    expect(listen.status).toBe("preparing");
    expect(calls.length).toBe(before + 1);
    expect(calls.at(-1)?.text).toBe(paragraphText(0));
    await act(async () => calls.at(-1)?.resolve());
    expect(listen.status).toBe("playing");
    expect(speaking()).toBe(el(0));
    expect(speak).not.toHaveBeenCalled();
  });

  it("uses a plain sentence for an error the server didn't write", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(0);
    await act(async () =>
      calls[0].reject(new Error("fetch failed: ECONNRESET")),
    );
    expect(listen.error).toBe("The voice stopped.");
  });

  it("lets the playing clip finish when a later clip fails, and fails when the voice reaches it", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(0);
    await settle(0);
    await act(async () => calls[1].reject(new ConvexError("Rate limited.")));
    expect(listen.status).toBe("playing");
    expect(audio().pause).not.toHaveBeenCalled();
    await ended();
    await elapse(400);
    expect(listen.status).toBe("failed");
    expect(listen.index).toBe(1);
    expect(listen.error).toBe("Rate limited.");
    // Retry asks again for just that item
    await act(async () => listen.retry());
    expect(calls.filter((c) => c.text === paragraphText(1))).toHaveLength(2);
  });

  it("fails and can retry when the browser can't play a clip", async () => {
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(0);
    await settle(0);
    await act(async () => audio().fire("error"));
    expect(listen.status).toBe("failed");
    expect(revoked).toContain("blob:clip-1");
    await act(async () => listen.retry());
    // Two requests are still out, so the retry waits for a free slot
    expect(listen.status).toBe("preparing");
    await settle(1);
    expect(calls.filter((c) => c.text === paragraphText(0))).toHaveLength(2);
  });

  it("treats a source that throws at once as a failed fetch", async () => {
    mountArticle(plain());
    await act(async () =>
      root.render(
        <Harness
          clip={() => {
            throw new ConvexError("NO_SPEECH_KEY");
          }}
        />,
      ),
    );
    await start(0);
    expect(listen.status).toBe("failed");
    expect(listen.error).toBe("NO_SPEECH_KEY");
  });
});

describe("choosing a voice", () => {
  it("offers the no-key choice, without a request, when no OpenRouter key is saved", async () => {
    query.value = { providers: ["openai"] };
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(2);
    expect(listen.needsKey).toBe(true);
    expect(listen.active).toBe(false);
    expect(calls).toHaveLength(0);
    expect(FakeAudio.all).toHaveLength(0);
    await act(async () => listen.stop());
    expect(listen.needsKey).toBe(false);
  });

  it("speaks with the device voice from the same place once the reader picks it, and remembers the choice for the session", async () => {
    query.value = { providers: [] };
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(2);
    await act(async () => listen.chooseDeviceVoice());
    expect(listen.mode).toBe("device");
    expect(listen.needsKey).toBe(false);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].text).toBe(paragraphText(2));
    expect(window.sessionStorage.getItem("marginalia.listenVoice")).toBe(
      "device",
    );
    expect(listen.status).toBe("playing");
    await act(async () => listen.stop());
    await start(0);
    expect(speak).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(0);
  });

  it("uses the device voice in a session where it was chosen, even with a key", async () => {
    window.sessionStorage.setItem("marginalia.listenVoice", "device");
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(0);
    expect(listen.mode).toBe("device");
    expect(calls).toHaveLength(0);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("tries the natural voice while the key check is still loading", async () => {
    query.value = undefined;
    mountArticle(plain());
    await act(async () => root.render(<Harness />));
    await start(0);
    expect(calls).toHaveLength(2);
  });
});
