import type { CompanionMode } from "./companion";
import { getArticleBody, getParagraphs, paragraphText } from "./paragraphs";

/** Local tools read only their original-numbered neighbours, never the full prose. */
export function companionContext(
  container: HTMLElement | null,
  input: {
    mode: CompanionMode;
    paragraphIndex: number | null;
    paragraphEnd?: number;
    selection?: string;
  },
) {
  const body = getArticleBody(container);
  if (
    !body ||
    input.paragraphIndex === null ||
    input.mode === "ask" ||
    input.mode === "article"
  )
    return { paragraphs: getParagraphs(body).map(paragraphText) };
  const start = input.paragraphIndex;
  // Older kept threads have no end index. If the selection isn't contained in
  // its first paragraph, retain the full legacy path rather than lose its end.
  if (
    input.mode !== "define" &&
    input.paragraphEnd === undefined &&
    input.selection
  ) {
    const first = body.querySelector<HTMLElement>(`[data-para="${start + 1}"]`);
    const squash = (text: string) => text.replace(/\s+/g, " ").trim();
    if (
      !first ||
      !squash(paragraphText(first)).includes(squash(input.selection))
    )
      return { paragraphs: getParagraphs(body).map(paragraphText) };
  }
  const end =
    input.mode === "define"
      ? start
      : Math.min(input.paragraphEnd ?? start, start + 20);
  const reach = input.mode === "define" ? 0 : 1;
  const paragraphIndices: number[] = [];
  const paragraphs: string[] = [];
  for (let i = Math.max(0, start - reach); i <= end + reach; i++) {
    const element = body.querySelector<HTMLElement>(`[data-para="${i + 1}"]`);
    if (!element || element.closest("[data-marginalia-ui]")) continue;
    paragraphIndices.push(i);
    paragraphs.push(paragraphText(element));
  }
  return { paragraphs, paragraphIndices };
}
