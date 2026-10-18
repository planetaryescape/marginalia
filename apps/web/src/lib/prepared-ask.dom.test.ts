// @vitest-environment happy-dom

import {
  representationHash,
  sourceHash,
} from "@marginalia/backend/prepared-representation";
import { afterEach, expect, it, vi } from "vitest";
import { preparedAsk } from "./prepared-ask";

const post = vi.hoisted(() => vi.fn());
vi.mock("./reader-transport", () => ({ postReaderRequest: post }));
afterEach(() => {
  post.mockReset();
  vi.restoreAllMocks();
});

it("extracts exact safe numbered prose once, preserves native selection, and uploads no corpus on reuse", async () => {
  const container = document.createElement("div");
  container.innerHTML =
    '<div data-article-body><p data-para="1">First <mark class="annotation-mark">exact<sup>12</sup></mark> &amp; safe.</p><aside data-marginalia-ui><p data-para="99">Private UI</p></aside><p data-para="2">第二段 🧪</p><p data-para="3"></p></div>';
  container.querySelector('[data-para="3"]')!.textContent =
    "Long paragraph ".repeat(20_000);
  document.body.append(container);
  const first = container.querySelector("p")!;
  const range = document.createRange();
  range.setStart(first.firstChild!, 1);
  range.setEnd(first.firstChild!, 4);
  window.getSelection()!.addRange(range);
  const before = window.getSelection()!.toString();
  const clone = vi.spyOn(first, "cloneNode");
  post.mockImplementation(async (_path, body) =>
    Response.json({
      prepared: {
        format: "safe-paragraphs-v1",
        sourceHash: body.sourceHash,
        representationHash: await representationHash(body.paragraphs),
      },
    }),
  );
  const prepared = preparedAsk({
    articleId: "article",
    unitIndex: 0,
    content: "source",
    contentHtml: "<p>source html</p>",
    container,
  });
  const signal = new AbortController().signal;
  const a = await prepared.get(signal);
  first.querySelector("sup")!.textContent = "40";
  container.style.color = "red";
  const b = await prepared.get(signal);
  expect(a).toEqual(b);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][1]).toMatchObject({
    unitIndex: 0,
    paragraphs: [
      "First exact & safe.",
      "第二段 🧪",
      "Long paragraph ".repeat(20_000).trim(),
    ],
  });
  expect(clone).toHaveBeenCalledTimes(1);
  expect(window.getSelection()!.toString()).toBe(before);
  await prepared.get(signal, true);
  expect(post).toHaveBeenCalledTimes(2);
  expect(clone).toHaveBeenCalledTimes(1);
  window.getSelection()!.removeAllRanges();
  container.remove();
});

it("does not publish a ref after cancellation during upload, and joins only the caller's transport", async () => {
  const controller = new AbortController();
  let finish!: (value: Response) => void;
  post.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const value = preparedAsk({
    articleId: "a",
    unitIndex: null,
    content: "",
    container: null,
  });
  const pending = value.get(controller.signal);
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  controller.abort();
  finish(
    Response.json({
      prepared: {
        format: "safe-paragraphs-v1",
        sourceHash: await sourceHash(""),
        representationHash: "a".repeat(64),
      },
    }),
  );
  await expect(pending).rejects.toThrow();
  post.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(value.get(new AbortController().signal)).rejects.toThrow(
    "Couldn't prepare",
  );
  expect(post).toHaveBeenCalledTimes(2);
});
