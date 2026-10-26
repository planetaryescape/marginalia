// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderReturnChip } from "./reader-return-chip";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const chip = () =>
  document.querySelector<HTMLButtonElement>("button.reader-return-chip");

describe("ReaderReturnChip", () => {
  it("shows nothing when there is nowhere to return to", async () => {
    await act(async () =>
      root.render(<ReaderReturnChip entry={null} onBack={vi.fn()} />),
    );
    expect(chip()).toBeNull();
  });

  it("names the paragraph it returns to, counting from one", async () => {
    await act(async () =>
      root.render(
        <ReaderReturnChip
          entry={{ scrollY: 400, paragraph: 2 }}
          onBack={vi.fn()}
        />,
      ),
    );
    expect(chip()?.textContent).toBe("↩ Back to ¶3");
    expect(chip()?.className).toContain("reader-menu");
  });

  it("returns the reader when clicked", async () => {
    const onBack = vi.fn();
    await act(async () =>
      root.render(
        <ReaderReturnChip
          entry={{ scrollY: 400, paragraph: 0 }}
          onBack={onBack}
        />,
      ),
    );
    await act(async () => chip()?.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
