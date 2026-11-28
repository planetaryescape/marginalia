"use client";

import { OwnerSetupFrame } from "@/components/owner-setup-frame";

export function UnclaimedReader() {
  return (
    <OwnerSetupFrame title="This reader is waiting for its owner">
      <p className="mb-5 text-sm text-[var(--reader-muted)]">
        If you deployed this reader, run this command from your checkout on the
        deployment machine. It opens a private, one-use owner setup link.
      </p>
      <pre className="mb-5 overflow-x-auto rounded-lg border border-[var(--reader-border)] p-4 text-sm">
        bun run setup:owner
      </pre>
      <p className="text-sm text-[var(--reader-muted)]">
        Visiting this page can’t make someone the owner. Other readers can join
        once the owner sends them an invitation.
      </p>
    </OwnerSetupFrame>
  );
}
