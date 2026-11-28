import Link from "next/link";
import { SettingsSection } from "@/components/settings-section";

export function OwnerSetupLink() {
  return (
    <SettingsSection
      title="Reader setup"
      description="Review your sign-in options and first library choices. Your existing account and reading stay intact."
    >
      <Link
        href="/setup"
        className="min-h-11 inline-flex items-center text-sm underline"
      >
        Open owner setup
      </Link>
    </SettingsSection>
  );
}
