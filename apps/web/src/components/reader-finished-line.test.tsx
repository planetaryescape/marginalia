// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinishedLine } from "./reader-finished-line";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const render = (finished: boolean, onMarkUnread = vi.fn()) =>
  act(async () =>
    root.render(
      <FinishedLine finished={finished} onMarkUnread={onMarkUnread} />,
    ),
  );

describe("FinishedLine", () => {
  it("shows nothing for an article that is not finished", async () => {
    await render(false);
    expect(document.body.textContent).toBe("");
  });

  it("says Finished with a Mark unread action once finished", async () => {
    const onMarkUnread = vi.fn();
    await render(true, onMarkUnread);
    expect(document.body.textContent).toBe("Finished · Mark unread");
    const button = document.querySelector("button") as HTMLButtonElement;
    await act(async () => button.click());
    expect(onMarkUnread).toHaveBeenCalledTimes(1);
  });
});
