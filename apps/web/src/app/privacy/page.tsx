import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy · Marginalia",
  description: "What Marginalia stores, when it shares data, and your choices.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updatedAt={{ dateTime: "2026-10-27", label: "27 October 2026" }}
    >
      <p>
        Marginalia is a free, invite-only reading app operated by Bhekani
        Khumalo. This policy describes this service, not independently hosted
        copies of its open-source code. Marginalia has no advertisements and
        does not sell your personal data.
      </p>

      <h2>What we store and why</h2>
      <ul>
        <li>
          <strong>Account and access details:</strong> your name, email,
          authentication records and sessions. Requesting access also stores
          your request and any optional note so the operator can manage invites.
          Passwords are stored as hashes; passkey private keys stay with your
          device or password manager.
        </li>
        <li>
          <strong>Your reading library:</strong> subscriptions, article URLs and
          content, saved Bible passages, highlights, notes, questions, AI
          responses, private Bible Study selections, runs, findings and
          evidence, saved Scripture references and their source connections,
          ratings and reading activity. These support reading, progress,
          recommendations and search, including a semantic index of your content
          when an embedding provider is connected.
        </li>
        <li>
          <strong>Settings and integrations:</strong> your preferences and any
          credentials you connect. Saved AI-provider keys and Readwise tokens
          are encrypted on the server. This is not end-to-end encryption: the
          service must decrypt them to make the requests you enable.
        </li>
        <li>
          <strong>Technical information:</strong> hosting and backend services
          process connection information and operational logs to run and debug
          the app. Logs can include article URLs, titles and provider errors.
        </li>
      </ul>

      <h2>When data leaves Marginalia</h2>
      <p>
        Vercel hosts the web app; Convex stores application data and runs the
        backend and authentication. Authorized operators can access stored data
        for administration and support. Account-level access controls separate
        readers&apos; libraries; they do not make data unreadable to the
        operator.
      </p>
      <p>
        AI features send article or passage text, your questions and relevant
        notes, highlights or conversation context to your connected providers.
        Supported providers include OpenAI, Anthropic and OpenRouter; OpenRouter
        forwards requests to the model provider. Requests may fall back to
        another available model. Importing articles or connecting a provider can
        also start background annotation and embedding work; AI processing is
        not limited to messages you explicitly send in chat.
      </p>
      <p>
        Deep Study sends public-domain WEB verses, chapter context, relevant
        saved note prose and permitted source excerpts to your configured AI
        provider. Notes provide personal context, not instructions or scholarly
        evidence. Unsaved drafts, highlights and selected wording from a
        licensed display are not included as study context. It saves the
        selection, source identities, retrieved evidence and result in your
        private library. It does not use the licensed Bible display wording as
        study evidence. Follow-up questions send your question, recent
        conversation and the saved study and sources to the provider; completed
        questions and answers stay with that study. See{" "}
        <Link href="/help/deep-study">How Deep study works</Link>. Keeping a
        cited reference saves its reference, reason and source connection; it
        does not fetch that passage or contact an AI provider.
      </p>
      <p>
        Providers apply their own privacy, retention and model-training terms.
        Do not submit sensitive material unless you are comfortable with those
        terms. Where enabled, optional web lookup also sends search queries to
        external services. A connected ChatGPT account is used only where the
        hosted integration is available.
      </p>
      <p>
        Connecting Readwise imports documents and highlights. Reading and
        highlight actions can sync changes back to Reader. Disconnecting stops
        future sync but does not remove earlier imports. Opening article or
        Scripture sources contacts their providers. Bible reading is off by
        default; enabling it allows passage retrieval, and Bible marginalia are
        requested separately. Third-party sites and services have their own
        policies.
      </p>
      <p>
        The licensed Bible catalogue and comparison view use YouVersion. Passage
        references are sent to its API, and Bible fonts and styles load from its
        services and font providers. This view does not save Scripture text or
        send it to AI providers. A per-account display token prevents multiple
        comparison views from remaining active together; it contains no
        Scripture text.
      </p>
      <p>
        If the operator uses the optional vault indexer, selected Markdown notes
        are sent to an embedding provider and stored in the operator&apos;s
        remote library index. This is not enabled for other readers by default.
      </p>

      <h2>Cookies and your device</h2>
      <p>
        Authentication uses cookies to keep you signed in. Browser storage
        remembers reading and interface preferences and may temporarily queue
        reading progress. The installed app caches an offline fallback page; it
        is not an offline copy of your library. Marginalia does not use
        advertising cookies. Clearing local storage does not delete your
        server-side account or library.
      </p>

      <h2>Retention and your choices</h2>
      <p>
        Library data stays available until removed or your account is deleted;
        archiving an article is not deletion. Invited readers can use Your
        account → Delete my account to end access and start background removal
        of their library, saved credentials and sign-in records. The
        operator&apos;s own account requires administrative handling. Copies
        already held in backups, logs or external providers are not necessarily
        removed at the same time. This policy does not promise an immediate
        purge or a fixed backup-retention period.
      </p>
      <p>
        You can disconnect integrations and disable Bible reading in settings;
        doing so does not erase saved notes or passages. For access, correction,
        a copy of your data, deletion of an access request, or other privacy
        requests, contact Bhekani Khumalo through the private channel you used
        to obtain your invitation. If you run your own copy, contact its
        operator instead. Do not post account details, credentials or private
        reading material in public GitHub issues.
      </p>
      <p>
        Your rights depend on applicable data-protection law and may include
        objection, restriction and a complaint to your local supervisory
        authority. Processing by hosting and AI providers may take place outside
        your country. No system can guarantee absolute security.
      </p>

      <h2>Changes</h2>
      <p>
        We will update this page when these practices change and revise the date
        above. See also the <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
