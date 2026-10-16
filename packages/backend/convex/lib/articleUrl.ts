/**
 * The form a web address takes when the library compares it: trimmed, without a
 * fragment, and without a trailing slash on the path. Returns null for anything
 * that is not an absolute http(s) address.
 */
export function normalizeArticleUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
}

/**
 * Every stored form a lookup should try for an address: the trimmed input, its
 * normalised form, and the normalised form with a trailing slash, since stored
 * URLs were never normalised. Stored URLs that carry a fragment are not matched.
 */
export function articleUrlVariants(raw: string): string[] {
  const trimmed = raw.trim();
  const normal = normalizeArticleUrl(trimmed);
  if (!normal) return [trimmed];
  const variants = new Set([trimmed, normal]);
  const url = new URL(normal);
  if (url.pathname !== "/") {
    url.pathname += "/";
    variants.add(url.href);
  }
  return [...variants];
}
