/**
 * The content fingerprint an upload grant is bound to: the file's SHA-256 as
 * 64 lowercase hex characters, plus its byte size.
 */
const HEX_SHA256 = /^[0-9a-f]{64}$/;

export function isHexSha256(value: string): boolean {
  return HEX_SHA256.test(value);
}

/**
 * Storage's own checksum as hex. Convex's docs call the `_storage` field hex,
 * but convex-test (and the dashboard's Digest header) use base64, so both are
 * accepted rather than trusting one. Null for anything else.
 */
export function storedSha256AsHex(stored: string): string | null {
  const lower = stored.toLowerCase();
  if (HEX_SHA256.test(lower)) return lower;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(stored)) return null;
  try {
    return Array.from(atob(stored), (c) =>
      c.charCodeAt(0).toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return null;
  }
}
