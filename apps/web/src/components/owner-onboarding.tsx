"use client";

import { api } from "@marginalia/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  type FirstLibraryChoice,
  OwnerLibraryStep,
} from "@/components/owner-library-step";
import {
  OwnerSecurityStep,
  type PasskeyEnrollment,
} from "@/components/owner-security-step";
import { OwnerSetupFrame } from "@/components/owner-setup-frame";
import { authClient } from "@/lib/auth-client";
import { requestFinder } from "@/lib/finder-request";

async function enrollPasskey(): Promise<PasskeyEnrollment> {
  try {
    const result = await authClient.passkey.addPasskey({
      name: "My reader passkey",
    });
    if (result.error)
      return {
        ok: false,
        message:
          "Passkey setup didn’t finish. Try again, or continue with your password.",
      };
    return { ok: true };
  } catch {
    return {
      ok: false,
      message:
        "Passkeys aren’t available here. You can continue with your password and add one later in Account.",
    };
  }
}

export function OwnerOnboarding() {
  const status = useQuery(api.ownerSetup.status, {});
  const begin = useMutation(api.ownerSetup.begin);
  const reviewSecurity = useMutation(api.ownerSetup.reviewSecurity);
  const finish = useMutation(api.ownerSetup.finish);
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    if (starting) return;
    setStarting(true);
    setError("");
    try {
      await begin({});
    } catch {
      setError(
        "Couldn't open setup. Try again; your existing account is unchanged.",
      );
    } finally {
      setStarting(false);
    }
  }
  async function choose(choice: FirstLibraryChoice) {
    await finish({});
    if (choice === "readwise") {
      router.replace("/feeds");
      return;
    }
    if (choice === "article") requestFinder();
    router.replace("/");
  }
  if (!status)
    return (
      <div className="auth-screen" role="status">
        Opening owner setup…
      </div>
    );
  switch (status.step) {
    case "security":
      return (
        <OwnerSecurityStep
          enroll={enrollPasskey}
          onContinue={async () => {
            await reviewSecurity({});
          }}
        />
      );
    case "library":
      return <OwnerLibraryStep onChoose={choose} />;
    case "available":
      return (
        <OwnerSetupFrame title="Finish making this reader yours">
          <p className="mb-6 text-sm text-[var(--reader-muted)]">
            Your owner account already exists. Review your sign-in options and
            choose how to start your library. Nothing here resets your account
            or existing reading.
          </p>
          <button
            className="app-button w-full"
            disabled={starting}
            onClick={start}
          >
            Continue setup
          </button>
          <Link
            href="/"
            className="mt-4 block py-3 text-center text-sm underline"
          >
            Back to my reader
          </Link>
          {error && (
            <p role="alert" className="mt-4 text-sm">
              {error}
            </p>
          )}
        </OwnerSetupFrame>
      );
    case "complete":
      return (
        <OwnerSetupFrame title="Your reader is ready">
          <p className="mb-6 text-sm text-[var(--reader-muted)]">
            You’re the owner. Add reading whenever you like, and invite other
            readers from Readers. AI setup is optional.
          </p>
          <Link href="/library" className="app-button w-full">
            Open my library
          </Link>
          <Link
            href="/account"
            className="mt-4 block py-3 text-center text-sm underline"
          >
            Manage sign-in options
          </Link>
        </OwnerSetupFrame>
      );
    case "not-owner":
      return (
        <OwnerSetupFrame title="This setup is for the reader owner">
          <p className="mb-6 text-sm text-[var(--reader-muted)]">
            Your invited account already has its own library. You don’t need to
            claim this reader.
          </p>
          <Link href="/library" className="app-button w-full">
            Open my library
          </Link>
        </OwnerSetupFrame>
      );
  }
}
