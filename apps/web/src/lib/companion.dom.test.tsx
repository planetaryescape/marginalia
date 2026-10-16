// @vitest-environment happy-dom
import { act, type RefObject, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanion } from "./companion";
import { DEFAULT_SETTINGS } from "./reader-settings";

const mocks = vi.hoisted(() => ({
  keepThread: vi.fn(),
  updateTurns: vi.fn(),
  removeThread: vi.fn(),
  createThread: vi.fn(),
  recordLookup: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (ref: string) => (mocks as never)[ref],
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    companionThreads: {
      keep: "keepThread",
      updateTurns: "updateTurns",
      remove: "removeThread",
      create: "createThread",
    },
    lookups: { record: "recordLookup" },
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

type Hook = ReturnType<typeof useCompanion>;
let latest: Hook;
let root: Root;
let host: HTMLElement;
let article: HTMLElement;
let range: Range;
const container: RefObject<HTMLElement | null> = { current: null };

function Harness({ articleId = "a1" }: { articleId?: string }) {
  container.current = article;
  latest = useCompanion({
    articleId: articleId as never,
    containerRef: container,
    title: "Hill walking",
    settings: DEFAULT_SETTINGS,
  });
  return null;
}

/** One streaming response the test feeds by hand. */
class Stream {
  private queue: string[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  private failure: Error | null = null;
  constructor(readonly signal: AbortSignal) {
    signal.addEventListener("abort", () => this.wake?.());
  }
  push(text: string) {
    this.queue.push(text);
    this.wake?.();
  }
  end() {
    this.ended = true;
    this.wake?.();
  }
  fail(error: Error) {
    this.failure = error;
    this.wake?.();
  }
  async read(): Promise<{ done: boolean; value?: string }> {
    for (;;) {
      if (this.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (this.failure) throw this.failure;
      const next = this.queue.shift();
      if (next !== undefined) return { done: false, value: next };
      if (this.ended) return { done: true };
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

let streams: Stream[] = [];
let bodies: Record<string, unknown>[] = [];

function navigation(type: string, path = "/read/a1") {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([
    { type, name: `http://localhost${path}` } as never,
  ]);
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
const mount = (articleId = "a1") =>
  act(async () => root.render(<Harness articleId={articleId} />));
/** A refresh unloads the page without React running any cleanup, so storage is untouched. */
const refresh = async () => {
  const snapshot = { ...sessionStorage };
  await unmount();
  sessionStorage.clear();
  for (const [key, value] of Object.entries(snapshot))
    sessionStorage.setItem(key, value);
};
const unmount = async () => {
  await act(async () => root.unmount());
  await settle();
  root = createRoot(host);
};
const ask = async (mode: "explain" | "define" = "explain") => {
  await act(async () => latest.start({ mode, range }));
  await settle();
};
const finish = async (text: string, index = streams.length - 1) => {
  await act(async () => {
    streams[index].push(text);
    streams[index].end();
  });
  await settle();
};
const stored = (id = "a1") =>
  JSON.parse(sessionStorage.getItem(`marginalia:answers:${id}`) ?? "[]");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.clear();
  streams = [];
  bodies = [];
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.keepThread.mockResolvedValue("thread-1");
  mocks.updateTurns.mockResolvedValue(undefined);
  mocks.recordLookup.mockResolvedValue("lookup-1");
  navigation("navigate");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const stream = new Stream(init.signal as AbortSignal);
      streams.push(stream);
      bodies.push(JSON.parse(init.body as string));
      return {
        ok: true,
        headers: { get: () => "test/model" },
        body: {
          pipeThrough: () => ({
            getReader: () => ({
              read: () => stream.read(),
              releaseLock() {},
            }),
          }),
        },
      };
    }),
  );
  document.body.innerHTML =
    '<article><div data-article-body><p data-para="1">Opening words here.</p><p data-para="2">The path climbed to a still tarn. Nobody spoke.</p></div></article><div id="host"></div>';
  article = document.querySelector("article") as HTMLElement;
  host = document.getElementById("host") as HTMLElement;
  const text = article.querySelectorAll("p")[1].firstChild as Text;
  range = document.createRange();
  range.setStart(text, text.data.indexOf("tarn"));
  range.setEnd(text, text.data.indexOf("tarn") + 4);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  await settle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("answers are temporary until kept", () => {
  it("streams an answer without writing anything to the server", async () => {
    await mount();
    await ask();
    expect(latest.thread?.status).toBe("streaming");
    expect(latest.thread?.paragraphIndex).toBe(1);
    await finish("A small mountain lake.");
    expect(latest.thread?.status).toBe("done");
    expect(latest.thread?.turns.at(-1)?.content).toBe("A small mountain lake.");
    // The server is only ever told about an answer that was kept.
    expect(mocks.keepThread).not.toHaveBeenCalled();
    expect(mocks.createThread).not.toHaveBeenCalled();
    expect(mocks.updateTurns).not.toHaveBeenCalled();
    expect(stored()).toHaveLength(1);
  });

  it("sends the article id so the server can add the summary", async () => {
    await mount();
    await ask();
    expect(bodies[0]).toMatchObject({ articleId: "a1", mode: "explain" });
  });

  it("does not hold an answer that is still streaming or failed", async () => {
    await mount();
    await ask();
    expect(stored()).toEqual([]);
    await act(async () => streams[0].fail(new Error("boom")));
    await settle();
    expect(latest.thread?.status).toBe("error");
    expect(stored()).toEqual([]);
  });

  it("follow-ups do not keep the answer", async () => {
    await mount();
    await ask();
    await finish("A small mountain lake.");
    await act(async () => latest.followUp("Is it deep?"));
    await finish("Not very.");
    expect(latest.thread?.turns).toHaveLength(3);
    expect(mocks.keepThread).not.toHaveBeenCalled();
    expect(mocks.updateTurns).not.toHaveBeenCalled();
    expect(stored()[0].turns).toHaveLength(3);
  });

  it("holds several answers, collapsed, and opens one at a time", async () => {
    await mount();
    await ask();
    await finish("First.");
    await ask();
    await finish("Second.", 1);
    expect(latest.answers).toHaveLength(2);
    const [first, second] = latest.answers;
    expect(latest.openId).toBe(second.id);
    await act(async () => latest.openAnswer(first.id));
    expect(latest.thread?.id).toBe(first.id);
    await act(async () => latest.collapse());
    expect(latest.thread).toBeNull();
    expect(latest.answers).toHaveLength(2);
  });

  it("keeps streaming into a collapsed answer", async () => {
    await mount();
    await ask();
    await act(async () => latest.collapse());
    await finish("Arrived while folded.");
    expect(latest.answers[0].turns[0].content).toBe("Arrived while folded.");
    expect(latest.openId).toBeNull();
  });
});

describe("a refresh keeps answers, leaving the article clears them", () => {
  it("restores unkept answers after a refresh of the same article, collapsed", async () => {
    await mount();
    await ask();
    await finish("A small mountain lake.");
    // The page reloads: the document is the article, loaded by a reload
    navigation("reload", "/read/a1");
    await refresh();
    await mount();
    expect(latest.answers).toHaveLength(1);
    expect(latest.answers[0]).toMatchObject({
      status: "done",
      selection: "tarn",
      mode: "explain",
    });
    expect(latest.openId).toBeNull();
  });

  it("allows a follow-up on a restored answer", async () => {
    await mount();
    await ask();
    await finish("A small mountain lake.");
    navigation("reload", "/read/a1");
    await refresh();
    await mount();
    await act(async () => latest.openAnswer(latest.answers[0].id));
    await act(async () => latest.followUp("Is it deep?"));
    expect(bodies.at(-1)?.history).toEqual([
      { role: "assistant", content: "A small mountain lake." },
      { role: "user", content: "Is it deep?" },
    ]);
    await finish("Not very.");
    expect(latest.thread?.turns).toHaveLength(3);
  });

  it("clears the answers when the reader navigates away", async () => {
    await mount();
    await ask();
    await finish("A small mountain lake.");
    expect(stored()).toHaveLength(1);
    await unmount();
    expect(stored()).toEqual([]);
  });

  it("does not restore what a hard navigation left behind", async () => {
    sessionStorage.setItem(
      "marginalia:answers:a1",
      JSON.stringify([
        {
          id: "old",
          mode: "define",
          selection: "tarn",
          paragraphIndex: 1,
          turns: [{ role: "assistant", content: "Left behind." }],
          model: null,
        },
      ]),
    );
    navigation("navigate", "/read/a1");
    await mount();
    expect(latest.answers).toEqual([]);
    expect(stored()).toEqual([]);
  });

  it("does not restore across articles: a refresh at another address finds nothing", async () => {
    sessionStorage.setItem(
      "marginalia:answers:a1",
      JSON.stringify([
        {
          id: "old",
          mode: "define",
          selection: "tarn",
          paragraphIndex: 1,
          turns: [{ role: "assistant", content: "Left behind." }],
          model: null,
        },
      ]),
    );
    navigation("reload", "/desk");
    await mount("a1");
    expect(latest.answers).toEqual([]);
    navigation("reload", "/read/a2");
    await mount("a2");
    expect(latest.answers).toEqual([]);
  });

  it("survives React's development remount, which cleans up and sets up at once", async () => {
    navigation("reload", "/read/a1");
    sessionStorage.setItem(
      "marginalia:answers:a1",
      JSON.stringify([
        {
          id: "x",
          mode: "simplify",
          selection: "tarn",
          paragraphIndex: 1,
          turns: [{ role: "assistant", content: "A lake." }],
          model: null,
        },
      ]),
    );
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
    await settle();
    expect(latest.answers).toHaveLength(1);
    expect(stored()).toHaveLength(1);
  });

  it("ignores damaged storage", async () => {
    sessionStorage.setItem("marginalia:answers:a1", "{not json");
    navigation("reload", "/read/a1");
    await mount();
    expect(latest.answers).toEqual([]);
  });
});

describe("Keep", () => {
  it("persists once, drops the temporary copy, and survives leaving", async () => {
    await mount();
    await ask();
    await finish("A small mountain lake.");
    const id = latest.answers[0].id;
    let kept = false;
    await act(async () => {
      kept = await latest.keep(id);
    });
    expect(kept).toBe(true);
    expect(mocks.keepThread).toHaveBeenCalledTimes(1);
    expect(mocks.keepThread).toHaveBeenCalledWith({
      articleId: "a1",
      mode: "explain",
      selection: "tarn",
      question: undefined,
      paragraphIndex: 1,
      turns: [{ role: "assistant", content: "A small mountain lake." }],
      model: "test/model",
    });
    expect(latest.answers[0].savedId).toBe("thread-1");
    expect(stored()).toEqual([]);
    await unmount();
    // Nothing is left to restore, and nothing kept was deleted
    expect(mocks.removeThread).not.toHaveBeenCalled();
  });

  it("keeps once when Keep is pressed twice before the first lands", async () => {
    let finishKeep: (id: string) => void = () => {};
    mocks.keepThread.mockReturnValue(
      new Promise<string>((resolve) => {
        finishKeep = resolve;
      }),
    );
    await mount();
    await ask();
    await finish("A small mountain lake.");
    const id = latest.answers[0].id;
    let second = true;
    await act(async () => {
      void latest.keep(id);
      second = await latest.keep(id);
    });
    expect(second).toBe(false);
    expect(latest.answers[0].keeping).toBe(true);
    await act(async () => finishKeep("thread-1"));
    await act(async () => {
      await latest.keep(id);
    });
    expect(mocks.keepThread).toHaveBeenCalledTimes(1);
  });

  it("does not keep an answer that is still streaming", async () => {
    await mount();
    await ask();
    const id = latest.answers[0].id;
    let kept = true;
    await act(async () => {
      kept = await latest.keep(id);
    });
    expect(kept).toBe(false);
    expect(mocks.keepThread).not.toHaveBeenCalled();
  });

  it("refuses a follow-up while Keep is in flight, so the record cannot go stale", async () => {
    mocks.keepThread.mockReturnValue(new Promise(() => {}));
    await mount();
    await ask();
    await finish("A small mountain lake.");
    await act(async () => {
      void latest.keep(latest.answers[0].id);
    });
    const calls = streams.length;
    await act(async () => latest.followUp("Is it deep?"));
    expect(streams.length).toBe(calls);
  });

  it("lets Keep be tried again after it fails", async () => {
    mocks.keepThread.mockRejectedValueOnce(new Error("offline"));
    await mount();
    await ask();
    await finish("A small mountain lake.");
    const id = latest.answers[0].id;
    let first = true;
    await act(async () => {
      first = await latest.keep(id);
    });
    expect(first).toBe(false);
    expect(latest.answers[0].keeping).toBe(false);
    expect(stored()).toHaveLength(1);
    await act(async () => {
      await latest.keep(id);
    });
    expect(latest.answers[0].savedId).toBe("thread-1");
  });

  it("adds follow-ups to a kept answer", async () => {
    await mount();
    await ask();
    await finish("A small mountain lake.");
    await act(async () => {
      await latest.keep(latest.answers[0].id);
    });
    await act(async () => latest.followUp("Is it deep?"));
    await finish("Not very.");
    expect(mocks.updateTurns).toHaveBeenCalledTimes(1);
    expect(mocks.updateTurns.mock.calls[0][0]).toMatchObject({
      threadId: "thread-1",
    });
    expect(mocks.updateTurns.mock.calls[0][0].turns).toHaveLength(3);
    expect(mocks.keepThread).toHaveBeenCalledTimes(1);
  });

  it("deleting a kept answer removes its record; dismissing an unkept one touches nothing", async () => {
    await mount();
    await ask();
    await finish("One.");
    await act(async () => latest.remove(latest.answers[0].id));
    expect(mocks.removeThread).not.toHaveBeenCalled();
    expect(latest.answers).toEqual([]);
    expect(stored()).toEqual([]);
    await ask();
    await finish("Two.", 1);
    await act(async () => {
      await latest.keep(latest.answers[0].id);
    });
    await act(async () => latest.remove(latest.answers[0].id));
    expect(mocks.removeThread).toHaveBeenCalledWith({ threadId: "thread-1" });
  });

  it("does not write to session storage after the reader has left", async () => {
    let finishKeep: (id: string) => void = () => {};
    mocks.keepThread.mockReturnValue(
      new Promise<string>((resolve) => {
        finishKeep = resolve;
      }),
    );
    await mount();
    await ask();
    await finish("One.");
    await ask();
    await finish("Two.", 1);
    await act(async () => {
      void latest.keep(latest.answers[0].id);
    });
    await unmount();
    await act(async () => finishKeep("thread-1"));
    await settle();
    expect(stored()).toEqual([]);
  });
});

describe("Define leaves a lookup", () => {
  it("records a completed Define once, with the sentence and a one-line sense", async () => {
    await mount();
    await ask("define");
    expect(mocks.recordLookup).not.toHaveBeenCalled();
    await finish(
      "**tarn** (noun): a small mountain lake. It is common in glacial country.",
    );
    expect(mocks.recordLookup).toHaveBeenCalledTimes(1);
    expect(mocks.recordLookup).toHaveBeenCalledWith({
      articleId: "a1",
      word: "tarn",
      sentence: "The path climbed to a still tarn.",
      paragraphIndex: 1,
      sense: "tarn (noun): a small mountain lake.",
    });
    // Unkept, so still no saved record
    expect(mocks.keepThread).not.toHaveBeenCalled();
  });

  it("does not record an aborted or failed Define", async () => {
    await mount();
    await ask("define");
    await act(async () => latest.remove(latest.answers[0].id));
    await settle();
    await ask("define");
    await act(async () => streams[1].fail(new Error("provider stopped")));
    await settle();
    await ask("define");
    await act(async () => streams[2].end());
    await settle();
    expect(latest.thread?.status).toBe("error");
    expect(mocks.recordLookup).not.toHaveBeenCalled();
  });

  it("does not record when the reader leaves mid-answer", async () => {
    await mount();
    await ask("define");
    await act(async () => streams[0].push("tarn: a lake."));
    await unmount();
    expect(mocks.recordLookup).not.toHaveBeenCalled();
  });

  it("does not record a follow-up, and does not record Explain", async () => {
    await mount();
    await ask("define");
    await finish("tarn: a lake.");
    await act(async () => latest.followUp("Any synonyms?"));
    await finish("Pool.");
    expect(mocks.recordLookup).toHaveBeenCalledTimes(1);
    await ask("explain");
    await finish("An explanation.", 2);
    expect(mocks.recordLookup).toHaveBeenCalledTimes(1);
  });

  it("repeats the same lookup on Regenerate and leaves the server to merge it", async () => {
    await mount();
    await ask("define");
    await finish("tarn: a lake.");
    await act(async () => latest.regenerate());
    await finish("tarn: a mountain pool.", 1);
    expect(mocks.recordLookup).toHaveBeenCalledTimes(2);
    expect(mocks.recordLookup.mock.calls[1][0]).toMatchObject({
      word: "tarn",
      sense: "tarn: a mountain pool.",
    });
  });

  it("still delivers the answer when the lookup log fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.recordLookup.mockRejectedValue(new Error("offline"));
    await mount();
    await ask("define");
    await finish("tarn: a lake.");
    await settle();
    expect(latest.thread?.status).toBe("done");
  });
});
