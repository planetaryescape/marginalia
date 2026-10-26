"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { deskLinkHref, parseWindowMinutes } from "@/lib/desk-link";

/**
 * Old session links keep working: the desk shows the pick now, so this
 * redirects to it. A redirect (not a second render of the desk) keeps one
 * place that owns the chosen state, and the address then says what the
 * reader is looking at. `replace` keeps this hop out of the history.
 */
export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // SAFETY: session links come from stored IDs; Convex validates this route parameter with v.id("sessions").
  const sessionId = id as Id<"sessions">;
  const session = useQuery(api.sessions.getById, { sessionId });
  const fromUrl = parseWindowMinutes(useSearchParams().get("m"));
  const minutes = fromUrl ?? session?.requestedMinutes;

  useEffect(() => {
    // Wait for the session: a link to one that isn't here must not reach the desk
    if (!session || minutes === undefined) return;
    router.replace(deskLinkHref({ minutes, sessionId }));
  }, [session, minutes, sessionId, router]);

  if (session === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p>This session isn't here.</p>
        <Link href="/">Back to Desk</Link>
      </div>
    );
  }
  return null;
}
