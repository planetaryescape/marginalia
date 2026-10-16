import { getToken } from "./auth-server";

export async function proxyReaderRequest(request: Request, path: string) {
  const token = await getToken();
  if (!token) return new Response("Sign in to your reader", { status: 401 });
  // Session cookies are the credential; require same-origin writes as well.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return new Response("Invalid origin", { status: 403 });
  const body = await request.text();
  if (body.length > (path === "engagement" ? 32_000 : 300_000))
    return new Response("Request too large", { status: 413 });
  const site =
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL?.replace(/\.cloud$/, ".site");
  const result = await fetch(`${site}/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
    signal: request.signal,
  });
  return new Response(result.body, {
    status: result.status,
    headers: {
      "Content-Type": result.headers.get("Content-Type") ?? "text/plain",
      "Cache-Control": "no-store",
      ...(result.headers.has("Server-Timing")
        ? { "Server-Timing": result.headers.get("Server-Timing") ?? "" }
        : {}),
      ...(result.headers.has("X-Companion-Model")
        ? { "X-Companion-Model": result.headers.get("X-Companion-Model") ?? "" }
        : {}),
    },
  });
}
