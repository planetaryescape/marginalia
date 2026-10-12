// @vitest-environment happy-dom
import { act, type PropsWithChildren, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArticleAsk } from "./article-ask";

// DOM tests exercise controls; browser checks cover animation and placement.
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: PropsWithChildren) => children,
  motion: {
    div: ({
      children,
      className,
    }: PropsWithChildren<{ className?: string }>) => (
      <div className={className}>{children}</div>
    ),
  },
}));

let root: Root;
const ask = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function ReaderControls() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav aria-label="Reading controls">
        <button onClick={() => setOpen(!open)}>Ask</button>
      </nav>
      <ArticleAsk
        hidden={false}
        open={open}
        onOpenChange={setOpen}
        onAsk={ask}
        depth="quick"
        onDepthChange={vi.fn()}
        web={false}
        onWebChange={vi.fn()}
        history={[]}
        onOpen={vi.fn()}
      />
    </>
  );
}
it("opens whole-article questions from the reading controls and closes without sending", async () => {
  await act(async () => root.render(<ReaderControls />));
  expect(
    document.querySelector('[aria-label="Ask about the whole article"]'),
  ).toBeNull();
  await act(async () =>
    document.querySelector<HTMLButtonElement>("nav button")?.click(),
  );
  expect(
    document.querySelector('[aria-label="Ask about the whole article"]'),
  ).not.toBeNull();
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Close question"]')
      ?.click(),
  );
  expect(
    document.querySelector('[aria-label="Ask about the whole article"]'),
  ).toBeNull();
  expect(ask).not.toHaveBeenCalled();
});

it("keeps the slash shortcut and Escape dismissal without sending a question", async () => {
  await act(async () => root.render(<ReaderControls />));
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    ),
  );
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Ask about the whole article"]',
  );
  expect(input).not.toBeNull();
  await act(async () =>
    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(
    document.querySelector('[aria-label="Ask about the whole article"]'),
  ).toBeNull();
  expect(ask).not.toHaveBeenCalled();
});
