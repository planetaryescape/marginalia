// The public API for other apps. Requests carry a personal API token, never a
// session cookie, so they pass straight through to the backend, which checks
// the token.
const MAX_BODY_BYTES = 2_000_000;

function backendUrl(path: string, search: string) {
  const site =
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL?.replace(/\.cloud$/, ".site");
  return `${site}/api/v1/${path}${search}`;
}

async function forward(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const path = (await ctx.params).path.map(encodeURIComponent).join("/");
  const body = request.method === "POST" ? await request.text() : undefined;
  if (body && body.length > MAX_BODY_BYTES)
    return Response.json(
      { code: "too_large", error: "This article is too large to send." },
      { status: 413 },
    );
  const result = await fetch(backendUrl(path, new URL(request.url).search), {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: request.headers.get("Authorization") ?? "",
    },
    body,
    signal: request.signal,
  });
  const headers = new Headers({
    "Content-Type": result.headers.get("Content-Type") ?? "application/json",
    "Cache-Control": "no-store",
  });
  const retryAfter = result.headers.get("Retry-After");
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return new Response(result.body, { status: result.status, headers });
}

export const GET = forward;
export const POST = forward;
