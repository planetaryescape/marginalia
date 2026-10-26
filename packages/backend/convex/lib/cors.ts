const DEFAULT_ORIGINS = "https://reader.bhekani.com";

/** The browser origins allowed to call the reader endpoints directly. */
export function readerOrigins(
  env: string | undefined = process.env.READER_ORIGINS,
): string[] {
  return (env?.trim() ? env : DEFAULT_ORIGINS)
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter((origin) => {
      try {
        const url = new URL(origin);
        return (
          ["http:", "https:"].includes(url.protocol) && url.origin === origin
        );
      } catch {
        return false;
      }
    });
}

/**
 * CORS headers for one request. The Bearer token is the credential, so no
 * cookies are involved and credentials are never allowed. A disallowed or
 * missing origin gets no Access-Control headers at all, only `Vary`.
 */
export function readerCorsHeaders(
  request: Request,
  origins: string[] = readerOrigins(),
): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !origins.includes(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Expose-Headers":
      "Server-Timing, X-Companion-Model, X-Reader-Prework-Rejection",
    "Timing-Allow-Origin": origin,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** Replaces any CORS headers on a response with this request's own. */
export function withReaderCors(
  request: Request,
  response: Response,
  origins?: string[],
): Response {
  const headers = new Headers(response.headers);
  const stale: string[] = [];
  headers.forEach((_value, name) => {
    if (name.startsWith("access-control-")) stale.push(name);
  });
  for (const name of stale) headers.delete(name);
  headers.delete("Timing-Allow-Origin");
  const origin = request.headers.get("Origin");
  if (origin && !(origins ?? readerOrigins()).includes(origin)) {
    headers.delete("Server-Timing");
    headers.delete("X-Companion-Model");
  }
  for (const [name, value] of Object.entries(
    readerCorsHeaders(request, origins),
  ))
    headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function readerPreflight(request: Request): Response {
  return withReaderCors(request, new Response(null, { status: 204 }));
}
