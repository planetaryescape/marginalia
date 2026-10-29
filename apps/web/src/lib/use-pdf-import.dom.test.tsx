// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePdfImport } from "./use-pdf-import";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  generateUploadUrl: vi.fn(),
  start: vi.fn(),
  dismiss: vi.fn(),
  uploadWithProgress: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: (name: string) =>
    ({
      gen: mocks.generateUploadUrl,
      start: mocks.start,
      dismiss: mocks.dismiss,
    })[name],
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    documentImports: {
      generateUploadUrl: "gen",
      start: "start",
      dismiss: "dismiss",
    },
  },
}));
vi.mock("./pdf-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pdf-import")>()),
  uploadWithProgress: mocks.uploadWithProgress,
}));
vi.mock("./topic-search-cache", () => ({
  invalidateTopicSearchCache: vi.fn(),
}));

let root: Root;
let hook: ReturnType<typeof usePdfImport>;
function Probe() {
  hook = usePdfImport();
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  root = createRoot(document.createElement("div"));
  mocks.generateUploadUrl.mockResolvedValue("https://upload.test/x");
  mocks.uploadWithProgress.mockResolvedValue("storage-id");
  mocks.start.mockResolvedValue({ ok: true, importId: "i1" });
});
afterEach(() => act(async () => root.unmount()));

describe("usePdfImport", () => {
  it("sends the file's SHA-256 and byte size when asking for the upload URL", async () => {
    await act(async () => root.render(<Probe />));
    const file = new File(["%PDF-1.4 hello"], "a.pdf", {
      type: "application/pdf",
    });
    await act(async () => hook.start(file));

    // SHA-256 of "%PDF-1.4 hello", computed independently by node
    const { createHash } = await import("node:crypto");
    expect(mocks.generateUploadUrl).toHaveBeenCalledWith({
      sha256: createHash("sha256").update("%PDF-1.4 hello").digest("hex"),
      size: file.size,
    });
    expect(mocks.uploadWithProgress).toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalledWith({
      storageId: "storage-id",
      fileName: "a.pdf",
    });
  });

  it("shows the server's sentence when the grant is refused, and uploads nothing", async () => {
    mocks.generateUploadUrl.mockRejectedValue(
      new Error("Reload and try again."),
    );
    await act(async () => root.render(<Probe />));
    await act(async () =>
      hook.start(new File(["%PDF-1.4"], "a.pdf", { type: "application/pdf" })),
    );
    expect(mocks.uploadWithProgress).not.toHaveBeenCalled();
    expect(hook.problem).toBe("Reload and try again.");
  });
});
