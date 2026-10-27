// @vitest-environment happy-dom
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScriptureStudyContent } from "./scripture-study-content";

const state = vi.hoisted(() => ({
  full: false,
  failed: false,
  running: false,
  aquifer: false,
  mutate: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: () => state.mutate,
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "scriptureStudy:get"
      ? {
          studyId: "study-1",
          articleId: "article-1",
          sourceHash: "fixture",
          selection: {
            referenceKey: "COL.2.20-COL.2.23",
            startVerseId: "COL.2.20",
            endVerseId: "COL.2.23",
            versificationId: "web",
          },
          activeRun: state.failed
            ? {
                runId: "run-2",
                status: "failed",
                errorCode: "findings_not_verified",
              }
            : state.running
              ? { runId: "run-2", status: "running" }
              : null,
          publishedRun:
            state.failed || state.running
              ? null
              : {
                  runId: "run-1",
                  status: "complete",
                  outcome: "partial",
                  modelId: "fixture",
                  evidenceSetHash: "fixture",
                  coverage: state.aquifer
                    ? [
                        {
                          lens: "literary",
                          status: "findings",
                          reason: "Fixture coverage",
                          reviewedSourceIds: ["aquifer-open-study-notes"],
                        },
                      ]
                    : [],
                  contextSummary: {
                    chapterReferenceKey: "COL.2.1-COL.2.23",
                    chapterCoverage: state.full
                      ? "full_retrieved_chapter"
                      : "bounded",
                    chapterRanges: [
                      state.full ? "COL.2.1-COL.2.23" : "COL.2.18-COL.2.23",
                    ],
                    readerNoteCount: 2,
                    readerContextChars: 500,
                    notesLimited: true,
                  },
                  generation: {
                    modelAttempts: 2,
                    repairAttempted: true,
                    correctedCitations: 0,
                    omittedFindings: 1,
                  },
                },
        }
      : getFunctionName(ref) === "scriptureStudyFollowUps:list"
        ? []
        : { page: [], isDone: true, continueCursor: "" },
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.full = false;
  state.failed = false;
  state.running = false;
  state.aquifer = false;
  state.mutate.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
// SAFETY: this synthetic ID reaches only the mocked Convex boundary in this DOM harness.
const render = () =>
  act(() =>
    root.render(
      <ScriptureStudyContent
        studyId={"study-1" as Id<"scriptureStudies">}
        onAnchor={() => {}}
        onRun={() => {}}
        onRemoved={() => {}}
      />,
    ),
  );

it("discloses omitted findings, bounded chapter coverage and personal-note context on saved replay without generation", () => {
  render();
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "One finding was left out",
  );
  expect(host.textContent).toContain("could not be verified");
  expect(host.textContent).toContain(
    "bounded WEB context; not the full chapter",
  );
  expect(host.textContent).toContain("Colossians 2:18–23");
  expect(host.textContent).toContain("2 saved reader note(s)");
  expect(host.textContent).toContain("not as evidence or instructions");
  expect(host.textContent).toContain("scope or input limits");
  expect(state.mutate).not.toHaveBeenCalled();
});
it("labels genuinely complete retrieved chapter context separately", () => {
  state.full = true;
  render();
  expect(host.textContent).toContain("full retrieved WEB chapter");
  expect(host.textContent).toContain("Colossians 2:1–23");
  expect(host.textContent).not.toContain("not the full chapter");
});
it("explains exhausted verification without silently retrying", () => {
  state.failed = true;
  render();
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "couldn’t verify this study",
  );
  expect(host.textContent).toContain("You can try again");
  expect(state.mutate).not.toHaveBeenCalled();
});

it("puts progress first and moves standing explanations to a fine-print help link without leaving the study", () => {
  state.running = true;
  render();
  expect(host.querySelector("p")?.getAttribute("role")).toBe("status");
  expect(host.querySelector("p")?.textContent).toContain(
    "Preparing your study.",
  );
  expect(host.textContent).not.toContain(
    "This study covers the containing verses",
  );
  expect(host.textContent).not.toContain(
    "Reopening this saved result does not generate again",
  );
  const help = host.querySelector<HTMLAnchorElement>(
    'a[href="/help/deep-study"]',
  );
  expect(help?.textContent).toContain("How Deep study works");
  expect(help?.target).toBe("_blank");
  expect(help?.rel).toContain("noopener");
  expect(state.mutate).not.toHaveBeenCalled();
});

it("keeps source attribution accessible inside collapsed study details", () => {
  state.aquifer = true;
  render();
  const details = [...host.querySelectorAll("details")].find(
    (element) =>
      element.querySelector("summary")?.textContent === "Coverage and limits",
  );
  expect(details?.open).toBe(false);
  expect(details?.textContent).toContain("Tyndale House Publishers");
  expect(
    details?.querySelector(
      'a[href="https://creativecommons.org/licenses/by-sa/4.0/"]',
    ),
  ).not.toBeNull();
});
it("admits only one explicit refresh during a rapid double click", async () => {
  let finish: ((value: { studyId: string; runId: string }) => void) | undefined;
  state.mutate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render();
  const refresh = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Refresh study",
  );
  if (!refresh) throw new Error("Missing refresh action");
  act(() => {
    refresh.click();
    refresh.click();
  });
  expect(state.mutate).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish?.({ studyId: "study-1", runId: "run-2" });
  });
});
