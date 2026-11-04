// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEpubFragment } from "./use-epub-fragment";
import { usePlaceRestore } from "./use-place-restore";

let root: Root;
let host: HTMLElement;
let landings: Element[];
let restores: unknown[];
const originalScrollIntoView = Element.prototype.scrollIntoView;
const originalScrollTo = window.scrollTo;

function Reader({
  unitKey,
  loaded,
  target = "epub-1-note%20one",
  enabled = true,
}: {
  unitKey: string;
  loaded: boolean;
  target?: string;
  enabled?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const status = useEpubFragment(ref, unitKey, enabled);
  usePlaceRestore(
    ref,
    unitKey,
    status === "pending" || status === "resolved" ? null : 50,
    undefined,
    Number(loaded),
  );
  return (
    <article ref={ref} data-fragment={status}>
      <div
        data-article-body
        ref={(body) => {
          if (body)
            body.getBoundingClientRect = () => new DOMRect(0, 0, 700, 3000);
        }}
      >
        {loaded && <p id={target}>Generated reading body</p>}
      </div>
    </article>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(
    null,
    "",
    "/read/generated?unit=1#epub-1-note%2520one",
  );
  landings = [];
  restores = [];
  Element.prototype.scrollIntoView = function () {
    landings.push(this);
  };
  window.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    restores.push({ options, y });
  };
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  window.scrollTo = originalScrollTo;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function render(loaded: boolean, unitKey = "book:1", target?: string) {
  await act(async () =>
    root.render(<Reader {...{ loaded, unitKey, target }} />),
  );
}

it("waits for the delayed reading body, then lands once without restoring", async () => {
  await render(false);
  expect(host.querySelector("article")?.dataset.fragment).toBe("pending");
  expect(landings).toHaveLength(0);
  expect(restores).toHaveLength(0);
  await render(true);
  expect(host.querySelector("article")?.dataset.fragment).toBe("resolved");
  expect(landings.map((element) => element.id)).toEqual(["epub-1-note%20one"]);
  expect(restores).toHaveLength(0);
  await render(true);
  expect(landings).toHaveLength(1);
});

it("restores the saved place when the ready body has no matching fragment", async () => {
  await render(false);
  expect(restores).toHaveLength(0);
  await render(true, "book:1", "different-target");
  expect(host.querySelector("article")?.dataset.fragment).toBe("missing");
  expect(landings).toHaveLength(0);
  expect(restores).toHaveLength(1);
});

it("refreshes a cleared hash after pushState unit navigation", async () => {
  await render(true);
  expect(landings).toHaveLength(1);
  window.history.pushState(null, "", "/read/generated?unit=2");
  await render(true, "book:2", "next-chapter");
  expect(host.querySelector("article")?.dataset.fragment).toBe("none");
  expect(landings).toHaveLength(1);
  expect(restores).toHaveLength(1);
});

it("lands on the new fragment after pushState unit navigation", async () => {
  await render(true);
  window.history.pushState(null, "", "/read/generated?unit=2#epub-2-note");
  await render(false, "book:2");
  expect(host.querySelector("article")?.dataset.fragment).toBe("pending");
  await render(true, "book:2", "epub-2-note");
  expect(landings.map((element) => element.id)).toEqual([
    "epub-1-note%20one",
    "epub-2-note",
  ]);
  expect(restores).toHaveLength(0);
});

it("responds to same-unit hash changes and browser history", async () => {
  await render(true);
  await act(async () => {
    window.history.replaceState(null, "", "/read/generated?unit=1#missing");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(host.querySelector("article")?.dataset.fragment).toBe("missing");
  await act(async () => {
    window.history.replaceState(
      null,
      "",
      "/read/generated?unit=1#epub-1-note%2520one",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(host.querySelector("article")?.dataset.fragment).toBe("resolved");
  expect(landings).toHaveLength(2);
});

it("does not intercept a PDF reader's saved place", async () => {
  await act(async () =>
    root.render(<Reader unitKey="pdf:1" loaded enabled={false} />),
  );
  expect(host.querySelector("article")?.dataset.fragment).toBe("none");
  expect(landings).toHaveLength(0);
  expect(restores).toHaveLength(1);
});

it("lands again when history returns before an intermediate unit loads", async () => {
  await render(true);
  window.history.pushState(null, "", "/read/generated?unit=2#epub-2-note");
  await render(false, "book:2");
  window.history.replaceState(
    null,
    "",
    "/read/generated?unit=1#epub-1-note%2520one",
  );
  await render(false);
  expect(host.querySelector("article")?.dataset.fragment).toBe("pending");
  await render(true);
  expect(landings.map((element) => element.id)).toEqual([
    "epub-1-note%20one",
    "epub-1-note%20one",
  ]);
});
