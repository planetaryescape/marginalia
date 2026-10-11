const UPLOAD_BATCH_SIZE = 25;

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

/** Replaces a whole file in one transaction; never delete first on the client. */
export async function replaceFile(
  convexUrl: string,
  apiKey: string,
  filePath: string,
  chunks: ChunkUpload[],
): Promise<void> {
  const response = await fetch(`${convexUrl}/api/vault/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "replace", filePath, chunks }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `Replace failed: ${response.status} ${await response.text()}`,
    );
}

export async function uploadChunks(
  convexUrl: string,
  apiKey: string,
  chunks: ChunkUpload[],
): Promise<void> {
  for (let i = 0; i < chunks.length; i += UPLOAD_BATCH_SIZE) {
    const batch = chunks.slice(i, i + UPLOAD_BATCH_SIZE);

    const response = await fetch(`${convexUrl}/api/vault/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "upload",
        chunks: batch,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Upload failed: ${response.status} ${error}`);
    }
  }
}

export async function deleteFile(
  convexUrl: string,
  apiKey: string,
  filePath: string,
): Promise<void> {
  const response = await fetch(`${convexUrl}/api/vault/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "delete",
      filePath,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Delete failed: ${response.status} ${error}`);
  }
}

export async function getRemoteHashes(
  convexUrl: string,
  apiKey: string,
): Promise<Record<string, string>> {
  const response = await fetch(`${convexUrl}/api/vault/hashes`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get hashes: ${response.status}`);
  }

  return response.json();
}
