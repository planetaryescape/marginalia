// @vitest-environment happy-dom
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import schema from "../../../../packages/backend/convex/schema";
import { useDocumentImportState } from "./use-document-import";

type Operations = Parameters<typeof useDocumentImportState>[0];
let root: Root;
let current: ReturnType<typeof useDocumentImportState> | undefined;
let operations: Operations;
let importId: Awaited<ReturnType<Operations["startImport"]>>;
const files: string[] = [];

function state() {
  if (!current) throw new Error("Hook not mounted");
  return current;
}

function Probe() {
  current = useDocumentImportState(operations);
  return <p role="alert">{current.problem}</p>;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  files.length = 0;
  current = undefined;
  const t = convexTest(schema, {
    "./_generated/api.js": () =>
      import("@marginalia/backend/convex/_generated/api"),
  });
  importId = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["fixture"]));
    return {
      ok: true,
      importId: await ctx.db.insert("documentImports", {
        userId: "reader",
        storageId,
        fileName: "fixture.pdf",
        status: "reading",
        step: "text",
        createdAt: 0,
        updatedAt: 0,
      }),
    };
  });
  operations = {
    generateUploadUrl: async () => "https://upload.test/fixture",
    upload: async (_url, file, progress) => {
      files.push(file.name);
      progress(75);
      return "fixture-storage";
    },
    startImport: async () => importId,
    dismiss: async () => null,
  };
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("rejects overlapping selections synchronously without replacing the active import", async () => {
  const grant = Promise.withResolvers<string>();
  operations.generateUploadUrl = () => grant.promise;
  act(() => root.render(<Probe />));
  let completion: Promise<void> | undefined;
  act(() => {
    const admission = state().start(new File(["fixture"], "first.pdf"));
    expect(admission.accepted).toBe(true);
    if (admission.accepted) completion = admission.completion;
    expect(state().start(new File(["other"], "second.epub"))).toEqual({
      accepted: false,
    });
  });
  expect(state().upload?.fileName).toBe("first.pdf");
  expect(state().problemFormat).toBe("pdf");
  expect(document.body.textContent).toContain(
    "Another file is still uploading.",
  );
  expect(document.body.textContent).not.toContain("second.epub");
  await act(async () => {
    grant.resolve("https://upload.test/fixture");
    await completion;
  });
  expect(files).toEqual(["first.pdf"]);
  expect(state().upload).toBeNull();
  if (!importId.ok) throw new Error("Expected fixture ID");
  expect(state().importId).toBe(importId.importId);
  await act(async () => {
    const admission = state().start(new File(["next"], "next.pdf"));
    expect(admission.accepted).toBe(true);
    if (admission.accepted) await admission.completion;
  });
  expect(files).toEqual(["first.pdf", "next.pdf"]);
  expect(state().problem).toBeNull();
});

it("retains the EPUB format for local refusal and admits a later retry", async () => {
  act(() => root.render(<Probe />));
  await act(async () => {
    const admission = state().start(new File([], "empty.epub"));
    expect(admission.accepted).toBe(true);
    if (admission.accepted) await admission.completion;
  });
  expect(state().problem).toBe("That file is empty.");
  expect(state().problemFormat).toBe("epub");
  expect(files).toEqual([]);
  await act(async () => {
    const admission = state().start(new File(["fixture"], "retry.pdf"));
    if (admission.accepted) await admission.completion;
  });
  expect(files).toEqual(["retry.pdf"]);
  expect(state().problem).toBeNull();
});

it.each([
  [
    new ConvexError("Sign in again, then dismiss this import."),
    "Sign in again, then dismiss this import.",
  ],
  [
    new Error("synthetic private title and path"),
    "Couldn't dismiss this import. Check your connection and try again.",
  ],
  [
    new ConvexError({ internal: "synthetic private title and path" }),
    "Couldn't dismiss this import. Check your connection and try again.",
  ],
  [
    "synthetic private title and path",
    "Couldn't dismiss this import. Check your connection and try again.",
  ],
])("surfaces safe dismiss recovery guidance for %s", async (error, sentence) => {
  operations.dismiss = async () => {
    throw error;
  };
  act(() => root.render(<Probe />));
  if (!importId.ok) throw new Error("Expected fixture ID");
  const id = importId.importId;
  await act(async () => {
    await state().dismiss(id);
  });
  expect(state().problem).toBe(sentence);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(sentence);
  expect(document.body.textContent).not.toContain("synthetic private");
  act(() => state().clearProblem());
  expect(state().problem).toBeNull();
  operations.dismiss = async () => null;
  await act(async () => {
    await state().dismiss(id);
  });
  expect(state().problem).toBeNull();
});
