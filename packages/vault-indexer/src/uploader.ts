import { type RequestOptions, requestJson } from "./network";

export interface ChunkUpload {
  userId: string;
  filePath: string;
  fileName: string;
  chunkIndex: number;
  content: string;
  tags?: string[];
  embedding: number[];
  fileHash: string;
  indexedAt: number;
}

type UploadRequest =
  | { action: "delete"; filePath: string }
  | { action: "replace"; filePath: string; chunks: ChunkUpload[] }
  | { action: "upload"; chunks: ChunkUpload[] };

async function upload(
  convexUrl: string,
  apiKey: string,
  body: UploadRequest,
  options: RequestOptions,
) {
  const payload = JSON.stringify(body);
  if (Buffer.byteLength(payload, "utf8") > 8_000_000)
    throw new Error(
      "File exceeds upload byte budget; previous index preserved",
    );
  await requestJson(
    `${convexUrl}/api/vault/upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: payload,
    },
    options,
  );
}

/** Atomic, idempotent retries are safe even after a lost acknowledgment. */
export async function replaceFile(
  convexUrl: string,
  apiKey: string,
  filePath: string,
  chunks: ChunkUpload[],
  options: RequestOptions = {},
): Promise<void> {
  if (chunks.length === 0 || chunks.length > 128)
    throw new Error("Expected 1–128 complete file chunks");
  await upload(
    convexUrl,
    apiKey,
    { action: "replace", filePath, chunks },
    options,
  );
}

/** Legacy append API: never retry an ambiguous write (it is not idempotent). */
export async function uploadChunks(
  convexUrl: string,
  apiKey: string,
  chunks: ChunkUpload[],
  options: RequestOptions = {},
): Promise<void> {
  for (let i = 0; i < chunks.length; i += 25)
    await upload(
      convexUrl,
      apiKey,
      { action: "upload", chunks: chunks.slice(i, i + 25) },
      { ...options, attempts: 1 },
    );
}

export async function deleteFile(
  convexUrl: string,
  apiKey: string,
  filePath: string,
  options: RequestOptions = {},
): Promise<void> {
  await upload(convexUrl, apiKey, { action: "delete", filePath }, options);
}

function hashMap(value: unknown): Record<string, string> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.values(value).some((hash) => typeof hash !== "string")
  )
    throw new Error("Invalid remote hash map; reconciliation aborted");
  return Object.assign(Object.create(null), value);
}

/** Old servers ignore protocol=2 and return their original map; accept it once. */
export async function getRemoteHashes(
  convexUrl: string,
  apiKey: string,
  options: RequestOptions = {},
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = Object.create(null);
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const url = new URL(`${convexUrl}/api/vault/hashes`);
    url.searchParams.set("protocol", "2");
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    const value = await requestJson(
      url.toString(),
      { headers: { Authorization: `Bearer ${apiKey}` } },
      options,
    );
    if (
      typeof value !== "object" ||
      value === null ||
      !("version" in value) ||
      value.version !== 2
    ) {
      if (cursor !== null)
        throw new Error("Hash protocol changed during pagination");
      return hashMap(value);
    }
    if (
      !("hashes" in value) ||
      !("cursor" in value) ||
      (value.cursor !== null && typeof value.cursor !== "string")
    )
      throw new Error("Invalid hash page; reconciliation aborted");
    Object.assign(hashes, hashMap(value.hashes));
    cursor = value.cursor;
    if (cursor !== null) {
      if (seen.has(cursor))
        throw new Error("Repeated hash cursor; reconciliation aborted");
      seen.add(cursor);
    }
  } while (cursor !== null);
  return hashes;
}
