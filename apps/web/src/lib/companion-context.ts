import {
  boundedLocalContext,
  crossInto,
  localUsageSentence,
} from "@marginalia/backend/local-context";
import type { CompanionMode } from "./companion";
import { getArticleBody, getParagraphs, paragraphText } from "./paragraphs";

/** Local tools read only selected original-numbered paragraphs and neighbours. */
export function companionContext(
  container: HTMLElement | null,
  input: {
    mode: CompanionMode;
    paragraphIndex: number | null;
    paragraphEnd?: number;
    selection?: string;
    occurrence?: number;
  },
) {
  const body = getArticleBody(container);
  if (input.mode === "ask" || input.mode === "article")
    return {
      paragraphs: getParagraphs(body)
        .filter((el) => !el.closest("[data-marginalia-ui]"))
        .map(paragraphText),
    };
  if (!body) return { paragraphs: [] };
  const texts = new Map<number, string>();
  const textAt = (index: number) => {
    if (texts.has(index)) return texts.get(index);
    const element = body.querySelector<HTMLElement>(
      `[data-para="${index + 1}"]`,
    );
    if (!element || element.closest("[data-marginalia-ui]")) return undefined;
    const text = paragraphText(element);
    texts.set(index, text);
    return text;
  };
  const squash = (text: string) => text.replace(/\s+/g, " ").trim();
  const selection = input.selection ?? "";
  let start = input.paragraphIndex;
  if (start === null) {
    // Legacy unplaced selections keep the same first-match fallback, but no
    // longer upload every paragraph just to let the server find that match.
    start = getParagraphs(body).findIndex((element, index) => {
      const text = paragraphText(element);
      texts.set(index, text);
      return squash(text).includes(squash(selection));
    });
    if (start < 0) start = 0;
  }
  let end =
    input.mode === "define"
      ? start
      : Math.min(input.paragraphEnd ?? start, start + 20);
  if (
    input.mode !== "define" &&
    input.paragraphEnd === undefined &&
    !squash(textAt(start) ?? "").includes(squash(selection))
  ) {
    let rest = squash(selection);
    while (end < start + 20) {
      const next = textAt(end + 1);
      if (next === undefined) break;
      const remainder = crossInto(
        rest,
        squash(textAt(end) ?? ""),
        squash(next),
      );
      if (remainder === null) break;
      rest = remainder;
      end++;
    }
  }
  const reach = input.mode === "define" ? 0 : 1;
  const paragraphs = [];
  for (let index = Math.max(0, start - reach); index <= end + reach; index++) {
    const text = textAt(index);
    if (text !== undefined) paragraphs.push({ index, text });
  }
  const bounded = boundedLocalContext({
    paragraphs,
    start,
    end,
    selection,
    occurrence: input.occurrence ?? 0,
  });
  return {
    paragraphs: bounded.paragraphs.map((p) => p.text),
    paragraphIndices: bounded.paragraphs.map((p) => p.index),
    paragraphIndex: start,
    paragraphEnd: end > start ? end : input.paragraphEnd,
    contextOccurrence: bounded.occurrence,
    sentence:
      input.mode === "define"
        ? localUsageSentence(
            textAt(start) ?? "",
            selection,
            input.occurrence ?? 0,
          )
        : undefined,
  };
}
