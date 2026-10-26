// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberTitle } from "@/lib/title-handoff";
import { SAVED_MS, WASH_MS } from "@/lib/use-timed-flag";
import { ChangeWash, InlineError, SavedMark } from "./in-place";
import { ReaderOpening } from "./reader-opening";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (ui: React.ReactNode) => act(async () => root.render(ui));

describe("Saved", () => {
  it("shows the word only while visible, inside a live region", async () => {
    await render(<SavedMark visible />);
    expect(
      document.querySelector('[role="status"] .saved-mark')?.textContent,
    ).toBe("Saved");
    await render(<SavedMark visible={false} />);
    expect(document.querySelector(".saved-mark")).toBeNull();
    expect(document.querySelector('[role="status"]')).not.toBeNull();
  });

  it("marks a result that stays true so it is not faded out", async () => {
    await render(<SavedMark visible hold />);
    expect(
      document.querySelector<HTMLElement>(".saved-mark")?.dataset.hold,
    ).toBe("true");
  });

  it("holds for its fade, 1.6 s and fade", () => {
    expect(SAVED_MS).toBe(160 + 1600 + 160);
  });
});

describe("errors in place", () => {
  it("says one sentence with Retry beside it", async () => {
    const retry = vi.fn();
    await render(<InlineError message="Couldn't save that." onRetry={retry} />);
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't save that.");
    await act(async () => alert?.querySelector("button")?.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("stops a second Retry while one is running", async () => {
    await render(<InlineError message="x" onRetry={vi.fn()} busy />);
    expect(document.querySelector("button")?.disabled).toBe(true);
  });
});

describe("the change wash", () => {
  const row = (value: number) => (
    <ChangeWash value={value} className="change-wash">
      row
    </ChangeWash>
  );
  const washing = () =>
    Boolean(
      document.querySelector<HTMLElement>(".change-wash")?.dataset.washing,
    );

  it("does not wash what was already there", async () => {
    await render(row(1));
    expect(washing()).toBe(false);
  });

  it("washes a changed value for 600 ms, then clears", async () => {
    await render(row(1));
    await render(row(2));
    expect(washing()).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WASH_MS - 1);
    });
    expect(washing()).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(washing()).toBe(false);
  });

  it("restarts the clock when the value changes again", async () => {
    await render(row(1));
    await render(row(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await render(row(3));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(washing()).toBe(true);
  });
});

describe("the reader heading before the article loads", () => {
  it("draws the title the desk held, named for the morph", async () => {
    rememberTitle("a9", "A short history of the margin");
    await render(<ReaderOpening articleId="a9" columnStyle={{}} />);
    expect(document.querySelector("h1")?.textContent).toBe(
      "A short history of the margin",
    );
  });

  it("keeps the reader column, metadata, summary and body slots on a deep link", async () => {
    await render(
      <ReaderOpening articleId="unknown" columnStyle={{ maxWidth: "65ch" }} />,
    );
    expect(document.querySelector("h1")).toBeNull();
    expect(document.querySelector("article")?.style.maxWidth).toBe("65ch");
    expect(document.querySelector("article")?.className).toContain(
      "pt-[calc(5rem",
    );
    expect(
      document.querySelector('[data-testid="reader-body-skeleton"]'),
    ).not.toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Summary, key claims",
    );
  });
  it("uses known headings while licensed wording loads and omits article-only slots for books", async () => {
    await render(
      <ReaderOpening
        articleId="known"
        title="Psalms 23"
        showSummary={false}
        columnStyle={{}}
      />,
    );
    expect(document.querySelector("h1")?.textContent).toBe("Psalms 23");
    expect(document.body.textContent).not.toContain("Summary, key claims");
  });
});
