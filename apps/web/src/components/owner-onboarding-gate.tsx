"use client";

import { api } from "@marginalia/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { OwnerOnboarding } from "@/components/owner-onboarding";
import { StartupWait } from "@/components/startup-wait";
import { rearmAuth } from "@/lib/auth-retry";

export function OwnerOnboardingGate({
  owner,
  children,
}: {
  owner: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const status = useQuery(api.ownerSetup.status, owner ? {} : "skip");
  if (!owner || pathname === "/setup") return children;
  if (status === undefined)
    return (
      <StartupWait
        phase="onboarding"
        onRetry={rearmAuth}
        opening={() => (
          <div className="auth-screen" role="status">
            Opening your reader…
          </div>
        )}
      />
    );
  if (status.step === "security" || status.step === "library")
    return <OwnerOnboarding />;
  return children;
}
