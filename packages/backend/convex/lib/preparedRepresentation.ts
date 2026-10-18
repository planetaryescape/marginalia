import { z } from "zod";
import { sha256Hex } from "./tokens";

/** Version the reader's paragraph protocol, not annotations, colours or layout. */
export const PREPARED_FORMAT = "safe-paragraphs-v1";
// Fits one Convex document, including worst-case UTF-8 legacy (300k UTF-16) uploads.
export const MAX_PREPARED_BYTES = 950_000;
export const preparedReferenceSchema = z.object({
  format: z.literal(PREPARED_FORMAT),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  representationHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PreparedReference = z.infer<typeof preparedReferenceSchema>;
export const prepareResponseSchema = z.object({
  prepared: preparedReferenceSchema,
});
export const prepareRequestSchema = z.object({
  articleId: z.string().max(100),
  unitIndex: z.number().int().min(0).max(100_000).optional(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  paragraphs: z.array(z.string().max(300_000)).min(1).max(4000),
});

export function sourceHash(content?: string, contentHtml?: string) {
  return sha256Hex(JSON.stringify([content ?? "", contentHtml ?? ""]));
}

/** JSON preserves boundaries, empty paragraphs and embedded NULs unambiguously. */
export function representationHash(paragraphs: readonly string[]) {
  return sha256Hex(JSON.stringify([PREPARED_FORMAT, paragraphs]));
}
