// @vitest-environment happy-dom
import { api } from "@marginalia/backend/convex/_generated/api";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDocumentImportState } from "@/lib/use-document-import";
import schema from "../../../../../packages/backend/convex/schema";

type Operations = Parameters<typeof useDocumentImportState>[0];
let root: Root;
let client: ConvexReactClient;
let operations: Operations;
let ready: NonNullable<FunctionReturnType<typeof api.documentImports.latest>>;
let grant: ReturnType<typeof Promise.withResolvers<string>>;
let started: ReturnType<typeof Promise.withResolvers<void>>;
let Desk: typeof import("./desk")["Desk"];
let active: ReturnType<typeof useDocumentImportState> | undefined;
const navigations: string[] = [];
const files: string[] = [];
const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push: (href) => {
    navigations.push(href);
  },
  replace() {},
  prefetch() {},
  bfcacheId: "desk-import",
};

class OfflineSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    queueMicrotask(() => this.onopen?.());
  }
  close() {
    this.onclose?.();
  }
  send() {}
}

function TestDesk() {
  active = useDocumentImportState(operations);
  return <Desk documentImport={active} fromFinish={false} />;
}

function drop(name: string, contents = "generated fixture") {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files: [new File([contents], name)], types: ["Files"] },
  });
  act(() => document.dispatchEvent(event));
}

function timeButton() {
  const button = document.querySelector<HTMLButtonElement>(
    '[aria-keyshortcuts="1"]',
  );
  if (!button) throw new Error("Missing five-minute choice");
  return button;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.endsWith("/api/auth/get-session"))
      throw new Error("Unexpected fixture HTTP request");
    return Response.json(null);
  });
  vi.stubGlobal("WebSocket", OfflineSocket);
  Desk = (await import("./desk")).Desk;
  navigations.length = 0;
  files.length = 0;
  active = undefined;
  grant = Promise.withResolvers<string>();
  started = Promise.withResolvers<void>();
  const t = convexTest(schema, {
    "./_generated/api.js": () =>
      import("@marginalia/backend/convex/_generated/api"),
  });
  const ids = await t.run(async (ctx) => {
    const articleId = await ctx.db.insert("articles", {
      userId: "reader",
      guid: "fixture",
      url: "https://example.com/fixture",
      title: "Generated fixture",
      extractionStatus: "extracted",
      annotationStatus: "skipped",
      createdAt: 0,
    });
    const storageId = await ctx.storage.store(new Blob(["fixture"]));
    const importId = await ctx.db.insert("documentImports", {
      userId: "reader",
      storageId,
      fileName: "fixture.pdf",
      status: "ready",
      step: "point",
      createdAt: 0,
      updatedAt: 0,
    });
    return { articleId, storageId, importId };
  });
  ready = {
    _id: ids.importId,
    fileName: "fixture.pdf",
    format: "pdf",
    status: "ready",
    step: "point",
    articleId: ids.articleId,
    title: "Generated fixture",
    author: undefined,
    diagnostic: undefined,
    pages: 1,
    minutes: 1,
    units: undefined,
    firstUnitTitle: undefined,
    firstUnitMinutes: undefined,
    failure: undefined,
  };
  operations = {
    generateUploadUrl: () => grant.promise,
    upload: async (_url, file) => {
      files.push(file.name);
      return ids.storageId;
    },
    startImport: async () => {
      started.resolve();
      return { ok: true, importId: ids.importId };
    },
    dismiss: async () => null,
  };
  client = new ConvexReactClient("https://fixture.convex.cloud", {
    unsavedChangesWarning: false,
  });
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root.render(
      <ConvexProvider client={client}>
        <AppRouterContext.Provider value={router}>
          <SearchParamsContext.Provider value={new URLSearchParams()}>
            <TestDesk />
          </SearchParamsContext.Provider>
        </AppRouterContext.Provider>
      </ConvexProvider>,
    ),
  );
  preferences("articles");
});

afterEach(async () => {
  act(() => root.unmount());
  await client.close();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function finish() {
  await act(async () => {
    grant.resolve("https://upload.test/fixture");
    await started.promise;
  });
  expect(active?.upload).toBeNull();
  publishReady();
}

function publishReady() {
  act(() => {
    void client.mutation(
      api.documentImports.dismiss,
      { importId: ready._id },
      {
        optimisticUpdate: (store) => {
          store.setQuery(api.documentImports.latest, {}, ready);
        },
      },
    );
  });
}

function preferences(scope: "articles" | "bible" | undefined) {
  act(() => {
    void client.mutation(
      api.bible.setPreferences,
      {},
      {
        optimisticUpdate: (store) =>
          store.setQuery(
            api.bible.preferences,
            {},
            scope === undefined
              ? undefined
              : { enabled: scope === "bible", scope, translation: "web" },
          ),
      },
    );
  });
}

it("preserves the chosen time and does not arm auto-open for a locally invalid file", async () => {
  act(() => timeButton().click());
  drop("empty.epub", "");
  expect(timeButton().getAttribute("aria-pressed")).toBe("true");
  expect(active?.problem).toBe("That file is empty.");
  expect(files).toEqual([]);
  publishReady();
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  act(() => active?.clearProblem());
  expect(document.body.textContent).toContain("Ready to read");
  expect(navigations).toEqual([]);
});

it.each([
  undefined,
  "bible",
] as const)("blocks document drop and pickers while preferences are %s", (scope) => {
  preferences(scope);
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    ),
  );
  drop("blocked.pdf");
  expect(active?.upload).toBeNull();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(document.body.textContent).not.toContain("choose a PDF or EPUB");
  expect(files).toEqual([]);
});

it("enables the typed-search document picker once article preferences resolve", async () => {
  preferences(undefined);
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    ),
  );
  expect(document.body.textContent).not.toContain("choose a PDF or EPUB");
  preferences("articles");
  expect(document.body.textContent).toContain("choose a PDF or EPUB");
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Missing document picker");
  Object.defineProperty(input, "files", {
    value: [new File(["fixture"], "picked.pdf")],
  });
  act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(active?.upload?.fileName).toBe("picked.pdf");
  await finish();
  expect(files).toEqual(["picked.pdf"]);
});

it("keeps the chosen time and leaves auto-open disarmed when a busy drop is rejected", async () => {
  act(() => timeButton().click());
  expect(timeButton().getAttribute("aria-pressed")).toBe("true");
  drop("first.pdf");
  expect(timeButton().getAttribute("aria-pressed")).toBe("false");
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", bubbles: true }),
    ),
  );
  expect(
    document
      .querySelector('[aria-keyshortcuts="2"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  drop("second.epub");
  expect(
    document
      .querySelector('[aria-keyshortcuts="2"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Another file is still uploading.",
  );
  await finish();
  expect(files).toEqual(["first.pdf"]);
  expect(active?.problem).toBeNull();
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(document.body.textContent).toContain("Generated fixture");
  expect(navigations).toEqual([]);
});

it("still arms auto-open for an admitted file", async () => {
  drop("fixture.pdf");
  await finish();
  expect(files).toEqual(["fixture.pdf"]);
  expect(navigations).toEqual([`/read/${ready.articleId}`]);
});

it("shows actionable, privacy-safe feedback when dismissing the ready card fails", async () => {
  operations.dismiss = async () => {
    throw new Error("synthetic private server path");
  };
  publishReady();
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Dismiss",
  );
  if (!button) throw new Error("Missing dismiss control");
  await act(async () => button.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn't dismiss this import. Check your connection and try again.",
  );
  expect(document.body.textContent).not.toContain("synthetic private");
  expect(document.querySelector("details")).toBeNull();
  expect(document.body.textContent).toContain("Couldn't dismiss this import");
  expect(document.body.textContent).not.toContain("Couldn't read this");
  expect(navigations).toEqual([]);
});
