// @vitest-environment happy-dom
import { act, type PropsWithChildren, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarginCard } from "./margin-card";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial: _i,
      animate: _a,
      transition: _t,
      ...props
    }: PropsWithChildren<Record<string, unknown>>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

let root: Root;

function Card({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  return (
    <>
      <article ref={ref} />
      <MarginCard
        containerRef={ref}
        layoutVersion={0}
        anchorKey="a"
        getAnchorRect={() => ({ top: 200, width: 40, height: 20 }) as DOMRect}
        title="Tension"
        label="Tension annotation"
        paragraphIndex={3}
        onJump={() => {}}
        onClose={onClose}
        body={<p>Full note text</p>}
      />
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("innerWidth", 1440);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        right: 1000,
        left: 300,
        top: 0,
        bottom: 3000,
        width: 700,
        height: 3000,
      }) as DOMRect,
  );
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MarginCard in the margin", () => {
  it("is a raised surface with a 1.5px connector and closes on Escape", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<Card onClose={onClose} />));
    const card = document.querySelector('[role="dialog"]');
    expect(card?.className).toContain("margin-card-raised");
    expect(card?.className).toContain("rounded-[10px]");
    expect(document.querySelector(".h-\\[1\\.5px\\]")).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
