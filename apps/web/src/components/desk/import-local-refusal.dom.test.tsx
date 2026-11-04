// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { documentFormat } from "@/lib/document-import";
import { uploadDocument } from "@/lib/document-upload";
import { ImportView } from "./import-slot";

let root: Root;
beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

it.each([
  0,
  32 * 1024 * 1024 + 1,
])("retains the EPUB label for a %s-byte local refusal", async (size) => {
  const file = new File([], "book.epub");
  Object.defineProperty(file, "size", { value: size });
  const requests: string[] = [];
  const unexpected = async (): Promise<never> => {
    requests.push("storage");
    throw new Error("Local refusals must not request storage");
  };
  const result = await uploadDocument(
    file,
    {
      generateUploadUrl: unexpected,
      upload: unexpected,
      startImport: unexpected,
    },
    () => {},
  );
  if (result.ok) throw new Error("Expected local refusal");
  expect(requests).toEqual([]);
  act(() =>
    root.render(
      <ImportView
        latest={null}
        armed={false}
        targetImportId={null}
        upload={null}
        problem={result.error}
        problemFormat={documentFormat(file) ?? undefined}
        onFile={() => {}}
        onClearProblem={() => {}}
        onDismiss={() => {}}
      >
        <p>resting</p>
      </ImportView>,
    ),
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn't read this EPUB",
  );
  expect(document.body.textContent).toContain(result.error);
  expect(document.body.textContent).not.toContain("PDF");
  expect(document.querySelector("details")).toBeNull();
});
