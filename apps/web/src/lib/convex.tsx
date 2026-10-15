"use client";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { MotionConfig } from "framer-motion";
import { type ReactNode, useCallback } from "react";
import { AuthGate } from "@/components/auth-gate";
import { authClient } from "./auth-client";

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
  const { data: session, isPending } = authClient.useSession();
  const sessionId = session?.session.id;
  const fetchAccessToken = useCallback(async () => {
    if (!sessionId) return null;
    try {
      // No token cache: Convex's forced refresh always reaches the auth server.
      const result = await authClient.convex.token({
        fetchOptions: { throw: false },
      });
      return result.data?.token ?? null;
    } catch {
      return null;
    }
  }, [sessionId]);
  return {
    isLoading: isPending,
    isAuthenticated: Boolean(session),
    fetchAccessToken,
  };
}
