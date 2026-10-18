// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  observeParagraphGeometry,
  paragraphGeometry,
} from "./paragraph-geometry";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("shares exactly one 220-paragraph geometry scan among three consumers per frame", () => {
  let frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    frames.push(fn),
  );
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  document.body.innerHTML = `<article><div data-article-body>${Array.from({ length: 220 }, (_, i) => `<p data-para="${i + 1}">Paragraph ${i}</p>`).join("")}<aside data-marginalia-ui><p data-para="221">Not prose</p></aside></div></article>`;
  const container = document.querySelector("article");
  const reads = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  const samples: unknown[] = [];
  const stops = Array.from({ length: 3 }, () =>
    observeParagraphGeometry(container, () =>
      samples.push(paragraphGeometry(container)),
    ),
  );
  const frame = () => {
    const pending = frames;
    frames = [];
    for (const callback of pending) callback(0);
  };
  frame();
  expect(reads).toHaveBeenCalledTimes(221); // body + actual prose, no UI host
  expect(samples[0]).toBe(samples[1]);
  expect(samples[1]).toBe(samples[2]);
  expect(paragraphGeometry(container)?.elements).toHaveLength(220);
  for (let i = 0; i < 20; i++) window.dispatchEvent(new Event("scroll"));
  frame();
  expect(reads).toHaveBeenCalledTimes(442);
  for (const stop of stops) stop();
});
