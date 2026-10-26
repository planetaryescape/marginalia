// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useListen } from "./reading-modes";

let root: Root;
let article: HTMLElement;
let listen: ReturnType<typeof useListen>;
const speak = vi.fn();
const cancel = vi.fn();
class Utterance {
  onend: (() => void) | null = null;
  constructor(public text: string) {}
}
function Harness({
  unit = "part-1",
  content = "Original prose",
  progress = 0,
}) {
  listen = useListen({ current: article }, "article-1", unit, content, "");
  return <output>{progress}</output>;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("speechSynthesis", { speak, cancel, getVoices: () => [] });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  document.body.innerHTML =
    '<article><div data-article-body><p data-para="1">First part prose.</p><p data-para="2">Later paragraph.</p></div></article><div id="mount"></div>';
  article = document.querySelector("article")!;
  Element.prototype.scrollIntoView = vi.fn();
  root = createRoot(document.getElementById("mount")!);
  speak.mockClear();
  cancel.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
it("keeps speech through progress changes but stops on a part or prose change, rejecting old utterance completions", async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => listen.speakFrom(0));
  const first: Utterance = speak.mock.calls[0][0];
  expect(listen.active).toBe(true);
  const before = cancel.mock.calls.length;
  await act(async () => root.render(<Harness progress={40} />));
  expect(cancel).toHaveBeenCalledTimes(before);
  expect(listen.active).toBe(true);
  await act(async () => root.render(<Harness unit="part-2" />));
  expect(listen.active).toBe(false);
  expect(article.querySelector("[data-speaking]")).toBeNull();
  await act(async () => first.onend?.());
  expect(speak).toHaveBeenCalledTimes(1);
  await act(async () => listen.speakFrom(0));
  await act(async () =>
    root.render(<Harness unit="part-2" content="Revised prose" />),
  );
  expect(listen.active).toBe(false);
});
