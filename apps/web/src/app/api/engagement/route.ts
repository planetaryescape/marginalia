import { proxyReaderRequest } from "@/lib/reader-proxy";
export async function POST(request: Request) {
  return proxyReaderRequest(request, "engagement");
}
