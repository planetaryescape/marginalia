// @vitest-environment happy-dom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanionThread } from "@/lib/companion";
import { CompanionCard } from "./companion-card";

let root: Root;
let host: HTMLDivElement;
const callbacks = {
  onClose: vi.fn(),
  onDelete: vi.fn(),
  onFollowUp: vi.fn(),
  onRegenerate: vi.fn(),
  onJump: vi.fn(),
  onKeep: vi.fn(),
  onResync: vi.fn(),
};

function Fixture({
  mode,
  wide,
  marginMode = "sidenotes",
}: {
  mode: CompanionThread["mode"];
  wide?: boolean;
  marginMode?: "sidenotes" | "phone" | "sheet";
}) {
  const containerRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(mode === "article");
  const isWide = wide ?? expanded;
  const thread: CompanionThread = {
    id: "thread-1",
    mode,
    selection: "",
    paragraphIndex: null,
    turns: [{ role: "assistant", content: "The answer appears exactly once." }],
    status: "done",
  };
  return (
    <div data-margin-mode={marginMode}>
      <CompanionCard
        thread={thread}
        inline
        containerRef={containerRef}
        layoutVersion={0}
        range={null}
        {...callbacks}
        wide={isWide}
        onExpand={() => setExpanded(true)}
        readerTypography={{
          "--reader-pane-size": "24px",
          "--reader-leading": "1.8",
          fontFamily: "Georgia",
        }}
      />
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  Object.values(callbacks).forEach((callback) => {
    callback.mockReset();
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.readerPane;
  vi.unstubAllGlobals();
});

describe("CompanionCard reader pane", () => {
  it("expands a passage answer beside the passage without duplicating its body", () => {
    act(() => root.render(<Fixture mode="ask" />));
    const expand = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Read answer beside passage"]',
    );
    expect(expand).not.toBeNull();
    act(() => expand?.click());
    expect(
      document.body.querySelector('dialog[aria-label="Ask passage"]'),
    ).not.toBeNull();
    expect(
      document.body.textContent?.match(/The answer appears exactly once\./g),
    ).toHaveLength(1);
  });

  it("opens whole-article answers in the wide pane automatically", () => {
    act(() => root.render(<Fixture mode="article" />));
    expect(
      document.body.querySelector('dialog[aria-label="Ask the article"]'),
    ).not.toBeNull();
    expect(
      document.body.textContent?.match(/The answer appears exactly once\./g),
    ).toHaveLength(1);
    expect(
      document
        .querySelector("dialog")
        ?.style.getPropertyValue("--reader-pane-size"),
    ).toBe("24px");
    expect(
      document
        .querySelector("dialog")
        ?.style.getPropertyValue("--reader-leading"),
    ).toBe("1.8");
  });

  it("keeps one root-owned expanded answer and its follow-up draft across margin mode changes", () => {
    act(() => root.render(<Fixture mode="ask" wide />));
    const draft = document.querySelector<HTMLInputElement>(
      'input[aria-label="Ask a follow-up"]',
    )!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(draft, "keep this question");
      draft.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => root.render(<Fixture mode="ask" wide marginMode="phone" />));
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(
      document.body.textContent?.match(/The answer appears exactly once\./g),
    ).toHaveLength(1);
    expect(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="Ask a follow-up"]',
      )?.value,
    ).toBe("keep this question");
  });
});
