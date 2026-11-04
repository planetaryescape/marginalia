// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { epubFragmentTarget } from "./use-epub-fragment";

afterEach(() => {
  document.body.replaceChildren();
});

it("decodes a fragment once to match an encoded EPUB DOM id", () => {
  const body = document.createElement("article");
  const note = document.createElement("p");
  note.id = "epub-1-note%20one";
  body.appendChild(note);
  document.body.appendChild(body);
  expect(epubFragmentTarget(body, "#epub-1-note%2520one")).toBe(note);
  expect(epubFragmentTarget(body, "#epub-1-note%20one")).toBe(note);
});

it("retries a target that arrives with a later reading unit render", () => {
  const body = document.createElement("article");
  document.body.appendChild(body);
  expect(epubFragmentTarget(body, "#epub-1-note")).toBeNull();
  const note = document.createElement("p");
  note.id = "epub-1-note";
  body.appendChild(note);
  expect(epubFragmentTarget(body, "#epub-1-note")).toBe(note);
});

it("never lands on an id outside the reading body", () => {
  const body = document.createElement("article");
  const outside = document.createElement("div");
  outside.id = "epub-1-note";
  document.body.append(body, outside);
  expect(epubFragmentTarget(body, "#epub-1-note")).toBeNull();
});

it.each([
  "",
  "#",
  "#%not-encoded",
  "#missing",
])("ignores fragment %s", (hash) => {
  expect(epubFragmentTarget(document.body, hash)).toBeNull();
  expect(epubFragmentTarget(null, hash)).toBeNull();
});
