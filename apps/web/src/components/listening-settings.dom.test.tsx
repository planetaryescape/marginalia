// @vitest-environment happy-dom
import { ConvexError } from "convex/values";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ListeningSettings,
  type VoiceSampleSource,
} from "./listening-settings";

const HEART = "openrouter:hexgrad/kokoro-82m#af_heart";
const EMMA = "openrouter:hexgrad/kokoro-82m#bf_emma";

const state = vi.hoisted(() => ({
  providers: ["openrouter"] as string[],
  setVoice: vi.fn(),
  clip: vi.fn(),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (query: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(query) === "userSettings:getSpeechVoice"
        ? {
            selected: HEART,
            voices: [
              {
                id: HEART,
                name: "Kokoro · Heart",
                character: "American woman",
              },
              { id: EMMA, name: "Kokoro · Emma", character: "British woman" },
            ],
          }
        : { providers: state.providers },
    useMutation: () =>
      Object.assign(state.setVoice, {
        withOptimisticUpdate: () => state.setVoice,
      }),
  };
});
vi.mock("@/lib/use-speech-clip", () => ({
  requestSpeechClip: (args: unknown) => state.clip(args),
}));

class FakeAudio {
  static all: FakeAudio[] = [];
  src = "";
  onended: (() => void) | null = null;
  constructor() {
    FakeAudio.all.push(this);
  }
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
}

let root: Root;
let listen: VoiceSampleSource;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Audio", FakeAudio);
  FakeAudio.all = [];
  state.providers = ["openrouter"];
  state.setVoice.mockReset().mockResolvedValue(null);
  state.clip.mockReset().mockResolvedValue(new Uint8Array([1, 2]).buffer);
  URL.createObjectURL = () => "blob:sample";
  URL.revokeObjectURL = () => undefined;
  listen = {
    articleId: "a1" as never,
    text: () => "The paragraph being read.",
    listenPlaying: true,
    listenPaused: false,
    toggleListenPause: vi.fn(() => {
      listen.listenPlaying = !listen.listenPlaying;
      listen.listenPaused = !listen.listenPaused;
    }),
  };
  document.body.innerHTML = '<div id="mount"></div>';
  root = createRoot(document.getElementById("mount") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const render = () =>
  act(async () =>
    root.render(<ListeningSettings sample={listen} onAddKey={() => {}} />),
  );
const radio = (id: string) =>
  document.querySelector(`input[value="${id}"]`) as HTMLInputElement;
const playButton = (name: string) =>
  document.querySelector(
    `[aria-label="Play a sample of ${name}"]`,
  ) as HTMLButtonElement;

it("lists the voices as a radio group with the saved one chosen", async () => {
  await render();
  expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
  expect(radio(HEART).checked).toBe(true);
  expect(radio(EMMA).checked).toBe(false);
});

it("saves a new choice", async () => {
  await render();
  await act(async () => radio(EMMA).click());
  expect(state.setVoice).toHaveBeenCalledWith({ voice: EMMA });
});

it("plays a sample of the paragraph in that voice, pausing Listen until the voices close", async () => {
  await render();
  await act(async () => playButton("Kokoro · Emma").click());
  expect(state.clip).toHaveBeenCalledWith({
    articleId: "a1",
    text: "The paragraph being read.",
    voice: EMMA,
  });
  expect(listen.toggleListenPause).toHaveBeenCalledTimes(1);
  expect(FakeAudio.all[0].src).toBe("blob:sample");
  expect(
    document.querySelector('[aria-label="Stop the Kokoro · Emma sample"]'),
  ).not.toBeNull();
  await act(async () => root.unmount());
  expect(listen.toggleListenPause).toHaveBeenCalledTimes(2);
  root = createRoot(document.getElementById("mount") as HTMLElement);
});

it("plays the focused voice's sample on Space instead of re-checking it", async () => {
  await render();
  const event = new KeyboardEvent("keydown", {
    key: " ",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => radio(HEART).dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(state.clip).toHaveBeenCalledWith(
    expect.objectContaining({ voice: HEART }),
  );
});

it("shows the action's sentence when a sample fails, with Retry", async () => {
  state.clip.mockRejectedValueOnce(
    new ConvexError("Your OpenRouter credit has run out."),
  );
  await render();
  await act(async () => playButton("Kokoro · Emma").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Your OpenRouter credit has run out.",
  );
});

it("disables the voices and points to Your account without an OpenRouter key", async () => {
  state.providers = [];
  await render();
  expect(radio(HEART).disabled).toBe(true);
  expect(document.body.textContent).toContain(
    "Add an OpenRouter key in Your account",
  );
});
