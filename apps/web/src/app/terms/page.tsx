import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { SOURCE_URL } from "@/components/source-link";

export const metadata: Metadata = {
  title: "Terms of Service · Marginalia",
  description: "The terms for using Marginalia and its connected services.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms govern the Marginalia reading service operated by Bhekani
        Khumalo. By using the service, you agree to these terms. If you do not
        agree, do not use it. Independently hosted copies may have different
        operators and terms.
      </p>

      <h2>Access and cost</h2>
      <p>
        Marginalia is free, invite-only, has no paywalled materials and carries
        no advertisements. An invitation does not guarantee permanent access.
        External AI providers and connected services may charge you under their
        own terms; Marginalia does not pay those charges for you. Connecting an
        API key may enable background work that consumes your provider credits.
      </p>
      <p>
        Keep your account, passkeys, recovery codes and API tokens secure. Do
        not share an invitation or credentials with someone who is not
        authorized to use them. Tell the operator if you believe your account
        has been compromised.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Use the service lawfully and only with content you are entitled to
        access and process. Do not bypass publisher restrictions or paywalls,
        access another reader&apos;s data, probe or disrupt the service,
        distribute malware, or misuse connected providers. You are responsible
        for the material you import and the permissions needed to send it to
        external services.
      </p>

      <h2>Your content and third-party rights</h2>
      <p>
        You keep the rights you hold in your own notes and other original
        contributions. You allow Marginalia and its service providers to store,
        process and display that material as needed to provide the features you
        use, including connected AI and synchronization features described in
        the <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <p>
        Articles, Bible translations and other imported material remain subject
        to their owners&apos; copyright and license terms. Access through
        Marginalia does not grant redistribution, bulk downloading, model
        training or other rights beyond those licenses. Translation availability
        and permitted storage or AI use can differ by provider. Do not remove
        required attribution. AI commentary is separate from the source text and
        is not an official publisher annotation or endorsement.
      </p>
      <p>
        Marginalia&apos;s source code is available under the licenses in its{" "}
        <a href={SOURCE_URL}>source repository</a>. Those software licenses do
        not license imported articles, Scripture or other readers&apos; data.
      </p>

      <h2>AI and connected services</h2>
      <p>
        AI-generated annotations, explanations, summaries and recommendations
        can be inaccurate, incomplete or misleading. Check the original text and
        cited sources. They are reading aids, not professional advice or
        authoritative religious interpretation. You decide whether and how to
        rely on them.
      </p>
      <p>
        Deep Study uses the selected World English Bible text and the sources
        disclosed with each result. Its source records identify retrieved
        material and its limits; they do not independently verify every
        free-form claim. Do not treat a printed-edition comparison as a claim
        about a particular manuscript or an original reading.
      </p>
      <p>
        Connected services have their own terms, privacy practices, usage limits
        and charges. They may change or become unavailable. Disconnecting an
        integration does not necessarily delete information already imported or
        sent to that provider.
      </p>

      <h2>Availability and ending access</h2>
      <p>
        The service is provided as available, without a promise of uninterrupted
        operation, error-free output or permanent storage. Keep separate copies
        of important material. We may change features or suspend access to
        protect the service, comply with law or address misuse.
      </p>
      <p>
        You may stop using Marginalia at any time. Invited readers can delete
        their accounts in Your account. See the Privacy Policy for how deletion
        and retained copies are handled. For help or a dispute, contact Bhekani
        Khumalo through the private channel used for your invitation.
      </p>

      <h2>Responsibility and changes</h2>
      <p>
        To the extent permitted by applicable law, the service is provided
        without warranties and the operator is not responsible for losses caused
        by outages, data loss, third-party services or reliance on AI output.
        Nothing in these terms excludes rights or liability that cannot legally
        be excluded.
      </p>
      <p>
        Changes to these terms will be posted here with an updated date. Review
        the current terms before continuing to use the service after a change.
      </p>
    </LegalPage>
  );
}
