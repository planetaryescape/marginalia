import {
  type PreparedReference,
  prepareResponseSchema,
  sourceHash,
} from "@marginalia/backend/prepared-representation";
import { abortable } from "./abortable";
import { companionContext } from "./companion-context";
import { postReaderRequest } from "./reader-transport";

/** Visit-local, lazy extraction/hash; only the explicit foreground Ask uploads. */
export function preparedAsk(input: {
  articleId: string;
  unitIndex: number | null;
  content?: string;
  contentHtml?: string;
  container: HTMLElement | null;
}) {
  let snapshot: { paragraphs: string[]; hash: Promise<string> } | undefined;
  let reference: PreparedReference | undefined;
  return {
    async get(
      signal: AbortSignal,
      refresh = false,
    ): Promise<PreparedReference> {
      signal.throwIfAborted();
      if (reference && !refresh) return reference;
      if (!snapshot)
        snapshot = {
          paragraphs: companionContext(input.container, {
            mode: "article",
            paragraphIndex: null,
          }).paragraphs,
          hash: sourceHash(input.content, input.contentHtml),
        };
      const hash = await snapshot.hash;
      signal.throwIfAborted();
      const response = await postReaderRequest(
        "companion/prepare",
        {
          articleId: input.articleId,
          unitIndex: input.unitIndex ?? undefined,
          sourceHash: hash,
          paragraphs: snapshot.paragraphs,
        },
        signal,
      );
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? "The article changed. Reopen it before asking again."
            : response.status === 413
              ? "The displayed text is too large to prepare without cutting it."
              : response.status === 401
                ? "Sign in to your reader."
                : "Couldn't prepare the displayed text. Try again.",
        );
      const body: unknown = await abortable(response.json(), signal);
      signal.throwIfAborted();
      const parsed = prepareResponseSchema.safeParse(body);
      if (!parsed.success || parsed.data.prepared.sourceHash !== hash)
        throw new Error("Couldn't prepare the displayed text. Try again.");
      reference = parsed.data.prepared;
      return reference;
    },
  };
}
