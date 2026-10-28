// @vitest-environment happy-dom
import { ConvexError } from "convex/values";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ClipSource } from "./use-natural-voice";
import { speechClipSource, useSpeechClip } from "./use-speech-clip";

const action = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useAction: () => action }));

const articleId = "article-1" as never;
const signal = new AbortController().signal;

it("turns the action's bytes into an audio/mpeg Blob with the same bytes", async () => {
  const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]).buffer;
  const clip = vi.fn().mockResolvedValue(bytes);
  const blob = await speechClipSource(clip, articleId)("Hello there.", signal);
  expect(blob.type).toBe("audio/mpeg");
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
    new Uint8Array(bytes),
  );
  // The article is the one the reader is on, and no voice is sent: the server picks the default
  expect(clip).toHaveBeenCalledWith({ articleId, text: "Hello there." });
});

it("lets the action's ConvexError through untouched, so its sentence reaches the bar", async () => {
  const error = new ConvexError("Your OpenRouter credit has run out.");
  const source = speechClipSource(vi.fn().mockRejectedValue(error), articleId);
  await expect(source("Hello.", signal)).rejects.toBe(error);
});

it("gives the same clip source back while the article and action stay the same", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const seen: ClipSource[] = [];
  function Probe({ id }: { id: string }) {
    seen.push(useSpeechClip(id as never));
    return null;
  }
  const mount = document.createElement("div");
  const root = createRoot(mount);
  await act(async () => root.render(<Probe id="a" />));
  await act(async () => root.render(<Probe id="a" />));
  await act(async () => root.render(<Probe id="b" />));
  expect(seen[1]).toBe(seen[0]);
  expect(seen[2]).not.toBe(seen[0]);
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
