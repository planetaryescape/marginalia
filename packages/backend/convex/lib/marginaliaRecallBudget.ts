/** Search concurrency is local to a recall, never per retrieval family. */
export const RECALL_SEARCH_CONCURRENCY = 4;
export const RECALL_CONTEXT_BYTES = 64 * 1024;
export const RECALL_BLOCK_BYTES = 12 * 1024;
export const RECALL_BATCH_ROWS = 2;
export const RECALL_BATCH_READ_BYTES = 2 * 1024 * 1024;
export const RECALL_BATCH_OUTPUT_BYTES = 32 * 1024;
export const RECALL_PAGE_READ_BYTES = 512 * 1024;

const encoder = new TextEncoder();
export function textBytes(text: string) {
  return encoder.encode(text).byteLength;
}

/** Cut on a Unicode code-point boundary, with an explicit omission marker. */
export function clipRecallText(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  const marker = "\n[Context clipped]";
  let end = Math.max(0, maxBytes - textBytes(marker));
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(bytes.subarray(0, end)) + marker;
}

/** FNV-1a: retain the existing source-version contract. */
export function recallHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Results occupy their input slots, irrespective of completion order. */
export async function recallPool<T, R>(
  jobs: readonly T[],
  run: (job: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(jobs.length);
  let next = 0;
  let failed = false;
  const outcomes = await Promise.allSettled(
    Array.from(
      { length: Math.min(RECALL_SEARCH_CONCURRENCY, jobs.length) },
      async () => {
        while (!failed) {
          const index = next++;
          if (index >= jobs.length) return;
          try {
            results[index] = await run(jobs[index], index);
          } catch (error) {
            failed = true;
            throw error;
          }
        }
      },
    ),
  );
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  if (rejected) throw rejected.reason;
  return results;
}
