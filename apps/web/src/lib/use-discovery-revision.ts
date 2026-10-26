"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useQuery } from "convex/react";

/** Observe before registering any work. Receipt only fences/evicts memory: no
 * React refresh event, broadcast echo, provider retry, or input reset. */
export function useDiscoveryRevision(
  session: string | null,
  observe: (token: string | null | undefined) => void,
) {
  const token = useQuery(
    api.discoveryRevision.current,
    session ? { session } : "skip",
  );
  observe(token);
  return {
    settled: token !== undefined,
    usable: token !== null && token !== undefined,
    token,
  };
}
