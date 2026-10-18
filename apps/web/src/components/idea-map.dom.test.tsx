// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IdeaMap } from "./idea-map";

vi.mock("framer-motion", () => {
  const element =
    (tag: string) =>
    ({
      children,
      initial: _i,
      animate: _a,
      exit: _e,
      transition,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      ...props
    }: PropsWithChildren<{
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
      onMouseEnter?: () => void;
      onMouseLeave?: () => void;
      onFocus?: () => void;
      onBlur?: () => void;
    }>) => {
      if (tag === "button")
        return (
          <button
            {...props}
            onMouseOver={onMouseEnter}
            onMouseOut={onMouseLeave}
            onFocus={onFocus}
            onBlur={onBlur}
            data-transition={JSON.stringify(transition)}
          >
            {children}
          </button>
        );
      if (tag === "path")
        return <path {...props} data-transition={JSON.stringify(transition)} />;
      if (tag === "p") return <p {...props}>{children}</p>;
      return <div {...props}>{children}</div>;
    };
  return {
    AnimatePresence: ({ children }: PropsWithChildren) => children,
    motion: {
      button: element("button"),
      path: element("path"),
      p: element("p"),
      div: element("div"),
    },
  };
});
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="mount"></div>';
  root = createRoot(document.getElementById("mount")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("ends its entrance once so repeated hover/focus feedback has no rank or edge delay", async () => {
  await act(async () =>
    root.render(
      <IdeaMap
        ideas={[
          {
            id: "a",
            role: "premise",
            label: "First",
            detail: "First premise",
            paragraphs: [1],
          },
          {
            id: "b",
            role: "conclusion",
            label: "Second",
            detail: "Conclusion",
            paragraphs: [2],
          },
        ]}
        links={[{ from: "a", to: "b", relation: "leads_to" }]}
        onJump={() => {}}
      />,
    ),
  );
  expect(
    JSON.parse(
      document
        .querySelector("path[data-transition]")!
        .getAttribute("data-transition")!,
    ).opacity.delay,
  ).toBeGreaterThan(0);
  await act(async () => vi.advanceTimersByTime(3000));
  const first = document.querySelector("button")!;
  for (let i = 0; i < 2; i++) {
    await act(async () =>
      first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    expect(
      [...document.querySelectorAll("button[data-transition]")].every(
        (button) =>
          JSON.parse(button.getAttribute("data-transition")!).delay === 0,
      ),
    ).toBe(true);
    const edge = document.querySelector("path[data-transition]")!;
    expect(
      JSON.parse(edge.getAttribute("data-transition")!).opacity.delay,
    ).toBe(0);
    await act(async () =>
      first.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })),
    );
  }
  await act(async () => first.focus());
  expect(JSON.parse(first.getAttribute("data-transition")!).delay).toBe(0);
});
