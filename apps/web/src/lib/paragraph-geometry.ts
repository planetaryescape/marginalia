import { getArticleBody, getParagraphs } from "@planetaryescape/reader";

type Geometry = {
  body: DOMRect;
  elements: HTMLElement[];
  rects: DOMRect[];
};
const frames = new WeakMap<HTMLElement, Geometry>();
const articleBody = (container: HTMLElement | null) =>
  container?.matches("[data-article-body]")
    ? container
    : getArticleBody(container);

/** All readers of a column in the current animation frame share one DOM scan. */
export function paragraphGeometry(
  container: HTMLElement | null,
): Geometry | null {
  const body = articleBody(container);
  if (!body) return null;
  const cached = frames.get(body);
  if (cached) return cached;
  const elements = getParagraphs(body).filter(
    (el) => !el.closest("[data-marginalia-ui]"),
  );
  const geometry = {
    body: body.getBoundingClientRect(),
    elements,
    rects: elements.map((el) => el.getBoundingClientRect()),
  };
  frames.set(body, geometry);
  // Expire before next frame's consumers, not separately for every consumer.
  requestAnimationFrame(() => {
    if (frames.get(body) === geometry) frames.delete(body);
  });
  return geometry;
}

export function invalidateParagraphGeometry(container: HTMLElement | null) {
  const body = articleBody(container);
  if (body) frames.delete(body);
}

/** Scroll callbacks only schedule reads; no synchronous per-event column scans. */
export function observeParagraphGeometry(
  container: HTMLElement | null,
  measure: () => void,
) {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };
  schedule();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  const resize = new ResizeObserver(schedule);
  if (container) resize.observe(container);
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
  };
}
