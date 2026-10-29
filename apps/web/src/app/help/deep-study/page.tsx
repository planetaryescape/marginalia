import { SCRIPTURE_STUDY_SOURCE_NOTICES } from "@marginalia/backend/scripture-study";
import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "How Deep study works · Marginalia",
  description:
    "The context and sources behind a study, your notes and follow-up questions.",
};

export default function DeepStudyHelpPage() {
  return (
    <LegalPage title="How Deep study works" updatedAt={null}>
      <p>
        Deep study helps you look closely at selected Bible verses. Read its
        findings alongside the passage and open their sources when you want to
        check a claim. AI commentary is interpretation, not Scripture or a final
        authority.
      </p>

      <h2>What the study reads</h2>
      <p>
        The study uses the public-domain World English Bible (WEB), even when
        you read a different edition. It includes the full retrieved chapter
        when it fits, or a smaller surrounding passage when it does not. It does
        not assume that an English word in your displayed edition maps to a
        particular Greek or Hebrew word.
      </p>
      <p>
        Relevant saved note prose from this reading can help the model
        understand your questions. Notes are personal context, not instructions
        or scholarly evidence. Selected wording from a licensed display, note
        HTML, annotation prompts, highlights and unsaved drafts are excluded. A
        note that cannot safely be placed at an exact verse may be treated as
        chapter-level context or omitted.
      </p>
      <p>
        Open <strong>Coverage and limits</strong> in a saved study to see which
        passages and sources were available, how many saved notes were used, and
        whether context was shortened. Note text is not copied into the study’s
        evidence records. See the <Link href="/privacy">Privacy Policy</Link>{" "}
        for provider sharing and retention.
      </p>

      <h2>Findings and follow-up questions</h2>
      <p>
        The app checks citations before saving findings and can ask the model to
        correct a draft. It may leave out findings that cannot be verified or
        return no findings. Source checks do not guarantee that every
        interpretation is correct or that the available sources cover every
        scholarly view.
      </p>
      <p>
        A study should explain the passage in its literary setting before
        drawing a bridge to readers now. A modern illustration is a suggested
        response, not another biblical command. If a finding is omitted after
        correction, the connected teaching is withheld rather than left resting
        on a missing step.
      </p>
      <p>
        After a study finishes, use <strong>Ask a follow-up</strong> to ask
        about the passage, a finding or its sources. When another Bible passage
        is needed, the answer can retrieve its WEB text and save it with its
        citations. Earlier answers keep their original sources. This does not
        search the wider web. If the available sources cannot settle a question,
        the answer explains what is missing.
      </p>
      <p>
        Completed questions, answers and their additional sources stay with that
        version of the study while it is saved. You can open a citation to check
        the text used, including after reopening the study.
      </p>

      <h2>Saved results, new requests and cost</h2>
      <p>
        Reopening a saved study does not generate it again. Refresh, Retry and
        each follow-up question are new requests to your configured AI provider
        and may incur cost. Stopping an answer or closing an unfinished study
        cannot recall work already sent to a provider.
      </p>
      <p>
        Each saved study allows up to 12 completed follow-up answers and 24
        attempts in total, including failed or stopped requests. These limits do
        not guarantee a maximum provider charge.
      </p>
      <p>
        Deleting a study does not delete your notes or marks. A failed refresh
        leaves the previous completed study available. Older studies may require
        you to select the passage again before starting a new run.
      </p>

      <h2 id="sources">Sources and attribution</h2>
      <p>
        WEB is public domain. Studies may also use sampled Greek or Hebrew text,
        historical dictionaries and comparisons of printed editions. Dictionary
        senses are not automatically contextual meanings; printed-edition
        comparisons do not identify manuscript witnesses or establish an
        original reading. Each study’s source details retain the excerpt,
        attribution and license for what was actually used.
      </p>
      <p>
        {SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.title}.{" "}
        {SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.attribution}
      </p>
      <p>
        Study commentary and follow-up answers based on this corpus include
        AI-generated adaptations. Those adaptations and source excerpts are
        offered under{" "}
        <a
          href={SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.licenseUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.license}
        </a>
        . {SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.changesNotice} Changes also
        include AI analysis. This source license does not change the
        application’s license. This is one adapted study-note corpus, not a
        survey of scholarly consensus.
      </p>
    </LegalPage>
  );
}
