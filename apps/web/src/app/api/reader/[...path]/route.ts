import { proxyReaderRequest } from "@/lib/reader-proxy";

const allowed = new Set(["companion", "library", "library/search"]);
export async function POST(
  request: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const path = (await ctx.params).path.join("/");
  if (!allowed.has(path)) return new Response("Not found", { status: 404 });
  return proxyReaderRequest(request, path);
}
