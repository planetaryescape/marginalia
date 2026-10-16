// @vitest-environment happy-dom
import { act, type PropsWithChildren, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationCard, type AnnotationCardData } from "./annotation-card";

const save = vi.hoisted(() => vi.fn());
const referenced = vi.hoisted(() => ({
  value: undefined as unknown,
  args: undefined as unknown,
}));
vi.mock("convex/react", () => ({
  useMutation: () => save,
  useQuery: (_ref: unknown, args: unknown) => {
    referenced.args = args;
    return referenced.value;
  },
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    annotations: { referencedArticle: "referencedArticle" },
    savedArticles: { save: "save" },
  },
}));
vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial: _i,
      animate: _a,
      transition: _t,
      ...props
    }: PropsWithChildren<Record<string, unknown>>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

let root: Root;

function Card({ annotation }: { annotation: AnnotationCardData }) {
  const ref = useRef<HTMLElement>(null);
  return (
    <>
      <article ref={ref} />
      <AnnotationCard
        inline
        annotation={annotation}
        reflections={[]}
        onReflect={async () => {}}
        onDeleteReflection={() => {}}
        paragraphIndex={2}
        containerRef={ref}
        layoutVersion={0}
        onClose={() => {}}
        onJump={() => {}}
      />
    </>
  );
}

const render = (annotation: Partial<AnnotationCardData>) =>
  act(async () =>
    root.render(
      <Card
        annotation={{
          _id: "a1",
          type: "assumption",
          anchorText: "anchor",
          content: "A short note.",
          ...annotation,
        }}
      />,
    ),
  );
const card = () => document.querySelector<HTMLElement>("[role='dialog']");
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === name);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  referenced.value = undefined;
  save.mockReset();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("AnnotationCard kinds", () => {
  const kinds = [
    ["tension", "Tension", "pushback", "var(--kind-tension)"],
    ["fallacy", "Fallacy", "pushback", "var(--kind-fallacy)"],
    ["assumption", "Assumption", "pushback", "var(--kind-assumption)"],
    ["unsupported", "Unsupported", "pushback", "var(--kind-unsupported)"],
    [
      "other_explanation",
      "Other explanation",
      "pushback",
      "var(--kind-other-explanation)",
    ],
    ["strong_point", "Strong point", "support", "var(--kind-strong-point)"],
    ["crux", "Crux", "support", "var(--kind-crux)"],
    [
      "cross_reference",
      "Connection",
      "in your notes",
      "var(--kind-connection)",
    ],
    ["context", "Context", "connection", "var(--kind-context)"],
    ["question", "Question", "for you", "var(--kind-question)"],
  ] as const;

  it.each(
    kinds,
  )("titles %s with its family and colour", async (type, name, family, color) => {
    await render({ type });
    expect(card()?.textContent).toContain(`${name} · ${family}`);
    expect(card()?.style.getPropertyValue("--card-accent")).toBe(color);
    expect(card()?.getAttribute("aria-label")).toBe(`${name} annotation`);
  });

  it("puts the fallacy's name in the title", async () => {
    await render({ type: "fallacy", fallacyName: "false dilemma" });
    expect(card()?.textContent).toContain("Fallacy · false dilemma · pushback");
  });

  it("asks pushback notes where the reader lands", async () => {
    await render({ type: "unsupported" });
    expect(card()?.querySelector("textarea")?.placeholder).toBe(
      "Where do you land on this?",
    );
  });

  it("draws a kind it doesn't know as a plain pencil note, without failing", async () => {
    await render({ type: "something_new" as never });
    expect(card()?.textContent).toContain("Note");
    expect(card()?.style.getPropertyValue("--card-accent")).toBe(
      "var(--pencil)",
    );
    expect(card()?.querySelector("textarea")?.placeholder).toBe(
      "Add your thoughts…",
    );
  });
});

describe("a connection to a library article", () => {
  const article = {
    _id: "art1",
    title: "The quiet cost of interruptions",
    estimatedReadMinutes: 7,
    read: false,
    saved: false,
  };

  it("shows the other article's title, minutes and read state, and Save for later", async () => {
    referenced.value = article;
    await render({ type: "cross_reference", articleRefId: "art1" });
    expect(referenced.args).toEqual({ annotationId: "a1" });
    expect(card()?.textContent).toContain("The quiet cost of interruptions");
    expect(card()?.textContent).toContain("7 min · unread");
    expect(card()?.textContent).toContain("in your library");
    expect(button("Save for later")).toBeDefined();
  });

  it("saves the article and never navigates", async () => {
    referenced.value = article;
    save.mockResolvedValue("id");
    const open = vi.fn();
    vi.stubGlobal("open", open);
    await render({ type: "cross_reference", articleRefId: "art1" });
    expect(card()?.querySelector("a[href]")).toBeNull();
    const before = window.location.href;
    await act(async () => button("Save for later")?.click());
    expect(save).toHaveBeenCalledWith({ articleId: "art1" });
    expect(open).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
  });

  it("shows Saved, disabled, once the article is saved", async () => {
    referenced.value = { ...article, saved: true, read: true };
    await render({ type: "cross_reference", articleRefId: "art1" });
    expect(card()?.textContent).toContain("7 min · read");
    expect(button("Save for later")).toBeUndefined();
    expect((button("Saved") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => button("Saved")?.click());
    expect(save).not.toHaveBeenCalled();
  });

  it("says so in place when saving fails", async () => {
    referenced.value = article;
    save.mockRejectedValue(new Error("offline"));
    await render({ type: "cross_reference", articleRefId: "art1" });
    await act(async () => button("Save for later")?.click());
    expect(card()?.querySelector("[role='alert']")?.textContent).toBe(
      "Couldn't save that. Try again.",
    );
    expect((button("Save for later") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("shows nothing for an article that is gone, and nothing for a vault note", async () => {
    referenced.value = null;
    await render({ type: "cross_reference", articleRefId: "art1" });
    expect(button("Save for later")).toBeUndefined();
    referenced.value = article;
    await render({
      type: "cross_reference",
      notePath: "Reading/attention.md",
      noteExcerpt: "From my vault.",
    });
    expect(button("Save for later")).toBeUndefined();
    expect(card()?.textContent).toContain("From my vault.");
  });
});
