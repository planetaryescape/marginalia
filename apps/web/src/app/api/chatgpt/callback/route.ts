import { api } from "@marginalia/backend/convex/_generated/api";
import { fetchAuthAction, getToken } from "@/lib/auth-server";

// Sign in with ChatGPT returns here (CHATGPT_REDIRECT_URI). The code and state
// go to Convex with the signed-in reader's session, so only the reader who
// began the sign-in can finish it. Tokens never reach the browser.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state) return new Response("Not found", { status: 404 });
  let status = "failed";
  if (await getToken()) {
    try {
      ({ status } = await fetchAuthAction(api.chatgpt.complete, {
        state,
        code: url.searchParams.get("code") ?? undefined,
        error: url.searchParams.get("error") ?? undefined,
      }));
    } catch {
      status = "failed";
    }
  }
  // Off on this server: the route does nothing
  if (status === "unavailable")
    return new Response("Not found", { status: 404 });
  const account = new URL("/account", url.origin);
  account.searchParams.set("chatgpt", status);
  return new Response(null, {
    status: 303,
    headers: {
      Location: account.toString(),
      "Cache-Control": "no-store",
      // The callback URL carries the authorization code
      "Referrer-Policy": "no-referrer",
    },
  });
}
