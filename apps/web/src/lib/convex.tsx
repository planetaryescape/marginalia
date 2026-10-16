"use client";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { MotionConfig } from "framer-motion";
import { type ReactNode, useCallback } from "react";
import { AuthGate } from "@/components/auth-gate";
import { authClient } from "./auth-client";
import { fetchTokenWithRetry, useAuthNonce } from "./auth-retry";
import { rememberConvexToken, setTokenSession } from "./convex-token";

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL as string,
  // Once the server accepts the first token, schedule its refresh instead of
  // fetching a second one straight away
  { initialAuthTokenReuse: true },
);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useReaderAuth}>
      <MotionConfig reducedMotion="user">
        <AuthGate>{children}</AuthGate>
      </MotionConfig>
    </ConvexProviderWithAuth>
  );
}

// Convex's public provider interface preserves the plugin-aware Better Auth
// client type; the integration's provider still uses an older client signature.
function useReaderAuth() {
  const { data: session, isPending, error } = authClient.useSession();
  const sessionId = session?.session.id;
  // Before any token is fetched, so the direct-call cache never mixes sessions
  setTokenSession(sessionId ?? null);
  // Bumped by "Reconnect" in the auth gate; a new function makes Convex start over
  const nonce = useAuthNonce();
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce only re-creates the function
  const fetchAccessToken = useCallback(async () => {
    if (!sessionId) return null;
    // No token cache: Convex's forced refresh always reaches the auth server.
    const token = await fetchTokenWithRetry(async () => {
      const result = await authClient.convex.token({
        fetchOptions: { throw: false },
      });
      if (result.data?.token) return { token: result.data.token };
      return { status: result.error?.status ?? 0 };
    });
    // Direct calls to the Convex HTTP endpoint reuse this token.
    rememberConvexToken(sessionId, token);
    return token;
  }, [sessionId, nonce]);
  // A failed session check is not a signed-out answer: keep waiting rather
  // than show the sign-in screen, and let the auth gate offer to reconnect
  const unknown = !session && Boolean(error) && error?.status !== 401;
  return {
    isLoading: isPending || unknown,
    isAuthenticated: Boolean(session),
    fetchAccessToken,
  };
}
