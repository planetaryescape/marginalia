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
      answerId: id,
      legacyId: undefined,
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
      occurrence: 0,
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

describe("older automatically saved threads", () => {
  const legacy = {
    _id: "old-thread",
    mode: "explain" as const,
    selection: "tarn",
    paragraphIndex: 1,
    turns: [{ role: "assistant" as const, content: "A lake." }],
    model: "test/model",
    createdAt: 1,
    updatedAt: 1,
  };

  it("loads as a temporary copy: follow-ups never reach the server without Keep", async () => {
    await mount();
    await act(async () => latest.open(legacy as never));
    expect(latest.thread?.savedId).toBeUndefined();
    await act(async () => latest.followUp("Is it deep?"));
    await finish("Not very.");
    expect(latest.thread?.turns).toHaveLength(3);
    expect(mocks.updateTurns).not.toHaveBeenCalled();
    expect(mocks.keepThread).not.toHaveBeenCalled();
    expect(mocks.createThread).not.toHaveBeenCalled();
  });

  it("is upgraded by Keep, which then owns its follow-ups", async () => {
    await mount();
    await act(async () => latest.open(legacy as never));
    let kept = false;
    await act(async () => {
      kept = await latest.keep(latest.answers[0].id);
    });
    expect(kept).toBe(true);
    expect(mocks.keepThread).toHaveBeenCalledTimes(1);
    expect(latest.answers[0]).toMatchObject({
      savedId: "thread-1",
      legacyId: undefined,
    });
  });

  it("deleting it deletes the row, or it would come straight back", async () => {
    await mount();
    await act(async () => latest.open(legacy as never));
    await act(async () => latest.remove("old-thread"));
    expect(mocks.removeThread).toHaveBeenCalledWith({ threadId: "old-thread" });
  });
});

describe("the back/forward cache", () => {
  const pageshow = (persisted: boolean) =>
    act(async () => {
      const event = new Event("pageshow");
      Object.defineProperty(event, "persisted", { value: persisted });
      window.dispatchEvent(event);
    });

  it("drops unkept answers, in memory and stored, when the page is restored from it", async () => {
    await mount();
    await ask();
    await finish("One.");
    await ask();
    await finish("Two.", 1);
    await act(async () => {
      await latest.keep(latest.answers[1].id);
    });
    await pageshow(true);
    expect(latest.answers.map((a) => a.savedId)).toEqual(["thread-1"]);
    expect(stored()).toEqual([]);
  });

  it("leaves answers alone on an ordinary page show, and a reload still restores them", async () => {
    await mount();
    await ask();
    await finish("One.");
    await pageshow(false);
    expect(latest.answers).toHaveLength(1);
    navigation("reload", "/read/a1");
    await refresh();
    await mount();
    expect(latest.answers).toHaveLength(1);
  });
});

describe("Dismiss while Keep is writing", () => {
  it("does nothing, so no kept row is orphaned", async () => {
    let finishKeep: (id: string) => void = () => {};
    mocks.keepThread.mockReturnValue(
      new Promise<string>((resolve) => {
        finishKeep = resolve;
      }),
    );
    await mount();
    await ask();
    await finish("One.");
    const id = latest.answers[0].id;
    await act(async () => {
      void latest.keep(id);
    });
    await act(async () => latest.remove(id));
    expect(latest.answers).toHaveLength(1);
    await act(async () => finishKeep("thread-1"));
    expect(latest.answers[0].savedId).toBe("thread-1");
    // Once it has landed, deleting removes the record it made
    await act(async () => latest.remove(id));
    expect(mocks.removeThread).toHaveBeenCalledWith({ threadId: "thread-1" });
  });
});

describe("forgetting a deleted record", () => {
  it("drops a kept answer deleted elsewhere from the margin", async () => {
    await mount();
    await ask();
    await finish("One.");
    await act(async () => {
      await latest.keep(latest.answers[0].id);
    });
    await act(async () => latest.forget("thread-1"));
    expect(latest.answers).toEqual([]);
    expect(latest.openId).toBeNull();
  });
});

describe("Define is told which usage was selected", () => {
  it("sends different requests for the first and the second 'bass'", async () => {
    article.innerHTML =
      '<div data-article-body><p data-para="1">He caught a bass. She played the bass. Nobody cared.</p></div>';
    const text = article.querySelector("p")?.firstChild as Text;
    const pick = (at: number) => {
      const r = document.createRange();
      r.setStart(text, at);
      r.setEnd(text, at + 4);
      return r;
    };
    await mount();
    await act(async () =>
      latest.start({ mode: "define", range: pick(text.data.indexOf("bass")) }),
    );
    await settle();
    await act(async () =>
      latest.start({
        mode: "define",
        range: pick(text.data.lastIndexOf("bass")),
      }),
    );
    await settle();
    expect(bodies[0]).toMatchObject({
      selection: "bass",
      sentence: "He caught a bass.",
      occurrence: 0,
    });
    expect(bodies[1]).toMatchObject({
      selection: "bass",
      sentence: "She played the bass.",
      occurrence: 1,
    });
    expect(JSON.stringify(bodies[0])).not.toBe(JSON.stringify(bodies[1]));
  });

  it("tells a passage Ask which occurrence was selected, without a sentence", async () => {
    article.innerHTML =
      '<div data-article-body><p data-para="1">He caught a bass. She played the bass. Nobody cared.</p></div>';
    const text = article.querySelector("p")?.firstChild as Text;
    const r = document.createRange();
    r.setStart(text, text.data.lastIndexOf("bass"));
    r.setEnd(text, text.data.lastIndexOf("bass") + 4);
    await mount();
    await act(async () =>
      latest.start({ mode: "ask", range: r, question: "Which bass?" }),
    );
    await settle();
    expect(bodies[0]).toMatchObject({ selection: "bass", occurrence: 1 });
    expect(bodies[0].sentence).toBeUndefined();
  });

  it("sends no sentence for the other tools", async () => {
    await mount();
    await ask("explain");
    expect(bodies[0].sentence).toBeUndefined();
    expect(bodies[0].occurrence).toBeUndefined();
  });
});

describe("the sentence of the occurrence that was selected", () => {
  it("records the second 'bass', not the first", async () => {
    article.innerHTML =
      '<div data-article-body><p data-para="1">He caught a bass. She played the bass. Nobody cared.</p></div>';
    const text = article.querySelector("p")?.firstChild as Text;
    const second = text.data.lastIndexOf("bass");
    const picked = document.createRange();
    picked.setStart(text, second);
    picked.setEnd(text, second + 4);
    await mount();
    await act(async () => latest.start({ mode: "define", range: picked }));
    await settle();
    await finish("bass: a low sound.");
    expect(mocks.recordLookup.mock.calls[0][0]).toMatchObject({
      word: "bass",
      sentence: "She played the bass.",
    });
  });
});

describe("a follow-up never costs the completed answer its place in storage", () => {
  it("keeps the completed transcript while the follow-up streams, then replaces it when done", async () => {
    await mount();
    await ask();
    await finish("A small mountain lake.");
    await act(async () => latest.followUp("Is it deep?"));
    await ask();
    await finish("Another answer.", 2);
    // A's follow-up is still streaming, and A is still stored as it was
    const during = stored();
    expect(during).toHaveLength(2);
    expect(during[0].turns).toEqual([
      { role: "assistant", content: "A small mountain lake." },
    ]);
    await finish("Not very.", 1);
    expect(stored()[0].turns).toHaveLength(3);
  });

  it("restores the completed answer after a follow-up failed, and after a reload", async () => {
    await mount();
    await ask();
    await finish("A small mountain lake.");
    await act(async () => latest.followUp("Is it deep?"));
    await act(async () => streams[1].fail(new Error("provider stopped")));
    await settle();
    expect(latest.thread?.status).toBe("error");
    expect(stored()).toHaveLength(1);
    await ask();
    await finish("Another.", 2);
    expect(stored().map((a: { turns: unknown[] }) => a.turns.length)).toEqual([
      1, 1,
    ]);
    navigation("reload", "/read/a1");
    await refresh();
    await mount();
    expect(latest.answers.map((a) => a.turns[0].content)).toEqual([
      "A small mountain lake.",
      "Another.",
    ]);
    expect(latest.answers.every((a) => a.status === "done")).toBe(true);
  });
});

describe("a distinct answer is a distinct Keep", () => {
  it("sends each answer's own id, so two answers to one passage are two keeps", async () => {
    mocks.keepThread
      .mockResolvedValueOnce("row-a")
      .mockResolvedValueOnce("row-b");
    await mount();
    await ask();
    await finish("First.");
    await ask();
    await finish("Second.", 1);
    await act(async () => {
      await latest.keep(latest.answers[0].id);
      await latest.keep(latest.answers[1].id);
    });
    const ids = mocks.keepThread.mock.calls.map((c) => c[0].answerId);
    expect(new Set(ids).size).toBe(2);
    expect(latest.answers.map((a) => a.savedId)).toEqual(["row-a", "row-b"]);
  });
});

describe("the range's own paragraphs", () => {
  it("sends the last paragraph a selection crosses", async () => {
    article.innerHTML =
      '<div data-article-body><p data-para="1">Opening.</p><p data-para="2">Why?</p><p data-para="3">No.</p><p data-para="4">A long closing paragraph.</p></div>';
    const paras = article.querySelectorAll("p");
    const crossing = document.createRange();
    crossing.setStart(paras[1].firstChild as Text, 0);
    crossing.setEnd(paras[2].firstChild as Text, 3);
    await mount();
    await act(async () => latest.start({ mode: "explain", range: crossing }));
    await settle();
    expect(bodies[0]).toMatchObject({ paragraphIndex: 1, paragraphEnd: 2 });
  });

  it("sends none for a selection inside one paragraph, or one that stops at the start of the next", async () => {
    const paras = article.querySelectorAll("p");
    const stops = document.createRange();
    stops.setStart(paras[0].firstChild as Text, 0);
    stops.setEnd(paras[1].firstChild as Text, 0);
    await mount();
    await act(async () => latest.start({ mode: "explain", range }));
    await settle();
    await act(async () => latest.start({ mode: "explain", range: stops }));
    await settle();
    expect(bodies[0].paragraphEnd).toBeUndefined();
    expect(bodies[1].paragraphEnd).toBeUndefined();
  });
});
