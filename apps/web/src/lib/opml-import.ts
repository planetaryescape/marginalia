export type OpmlEntry = { url: string; title: string };
export type OpmlOutcome = {
  url: string;
  status: "created" | "duplicate" | "invalid";
  message?: string;
};
export type OpmlProgress = {
  entries: OpmlEntry[];
  offset: number;
  outcomes: OpmlOutcome[];
};
const BATCH_COUNT = 10;
const BATCH_BYTES = 32 * 1024;
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Advance only acknowledged batches; an ambiguous batch is safe to replay. */
export async function importOpmlBatches(
  progress: OpmlProgress,
  send: (entries: OpmlEntry[]) => Promise<OpmlOutcome[]>,
) {
  while (progress.offset < progress.entries.length) {
    const batch: OpmlEntry[] = [];
    for (const entry of progress.entries.slice(
      progress.offset,
      progress.offset + BATCH_COUNT,
    )) {
      if (bytes([entry]) > BATCH_BYTES) {
        if (batch.length) break;
        progress.outcomes.push({
          url: entry.url.slice(0, 4096),
          status: "invalid",
          message: "Feed details exceed 32 KiB",
        });
        progress.offset++;
        break;
      }
      if (bytes([...batch, entry]) > BATCH_BYTES) break;
      batch.push(entry);
    }
    if (!batch.length) continue;
    const outcomes = await send(batch);
    if (outcomes.length !== batch.length)
      throw new Error(
        "The import acknowledgement was incomplete. Retry to continue.",
      );
    progress.outcomes.push(...outcomes);
    progress.offset += batch.length;
  }
}
