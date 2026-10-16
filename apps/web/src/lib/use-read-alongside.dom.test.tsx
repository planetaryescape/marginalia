// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadAlongside } from "./use-read-alongside";

const request = vi.hoisted(() => vi.fn());
let working: number[] | undefined;
vi.mock("convex/react", () => ({
  useMutation: () => request,
  useQuery: (_ref: unknown, args: unknown) =>
    args === "skip" ? undefined : working,
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: { alongside: { requestAhead: "r", workingSections: "w" } },
}));

// Eight sections of a made-up article
const content = Array.from(
  { length: 700 },
  (_, i) => `Claim ${i} holds in this setting.`,
).join(" ");

let root: Root;
let anchor: string | null = null;

function Probe(props: { id?: string; enabled?: boolean; progress: number }) {
  anchor = useReadAlongside({
    articleId: (props.id ?? "a1") as never,
    enabled: props.enabled ?? true,
    content,
    progress: props.progress,
  });
  return null;
}
const show = (props: React.ComponentProps<typeof Probe>) =>
  act(async () => root.render(<Probe {...props} />));

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue("scheduled");
  working = undefined;
  anchor = null;
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("reading alongside, from the reader", () => {
  it("asks for nothing near the start of a section", async () => {
    await show({ progress: 3 });
    expect(request).not.toHaveBeenCalled();
  });

  it("asks for the section after the one being read, once", async () => {
    await show({ progress: 7 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      articleId: "a1",
      currentSection: 0,
    });
    await show({ progress: 9 });
    expect(request).toHaveBeenCalledTimes(1);
    // Well into the next section
    await show({ progress: 22 });
    expect(request).toHaveBeenLastCalledWith({
      articleId: "a1",
      currentSection: 1,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("asks again after a failed request, and again for another article", async () => {
    request.mockRejectedValueOnce(new Error("offline"));
    await show({ progress: 7 });
    await show({ progress: 8 });
    expect(request).toHaveBeenCalledTimes(2);
    await show({ id: "a2", progress: 8 });
    expect(request).toHaveBeenLastCalledWith({
      articleId: "a2",
      currentSection: 0,
    });
  });

  it("does nothing while disabled", async () => {
    await show({ enabled: false, progress: 50 });
    expect(request).not.toHaveBeenCalled();
  });

  it("names where the section being written begins", async () => {
    working = [1];
    await show({ progress: 5 });
    expect(anchor).toMatch(/^Claim 94 holds in this setting/);
    working = [];
    await show({ progress: 6 });
    expect(anchor).toBeNull();
  });
});
