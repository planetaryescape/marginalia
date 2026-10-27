import { vi } from "vitest";
import { api } from "../convex/_generated/api";
import * as aiModels from "../convex/lib/aiModels";
import { sourceHash } from "../convex/lib/preparedRepresentation";
import { ownerTest, saveTestCredential } from "./owner";
export const selection = {
  referenceKey: "JHN.1.1-JHN.1.2",
  startVerseId: "JHN.1.1",
  endVerseId: "JHN.1.2",
  versificationId: "web",
};
export const content =
  "1:1 Public WEB verse one\n\n1:2 Public WEB verse two\n\n1:3 Public WEB verse three\n\n1:4 Public WEB verse four";
export const contentHtml = '<p id="JHN.1.1">LICENSED_DOM_CANARY</p>';
export const findings = [
  {
    findingId: "word-repetition",
    lens: "literary",
    anchor: {
      verseId: "JHN.1.1",
      referenceKey: selection.referenceKey,
      quote: "Public WEB verse one",
    },
    observation: "The supplied verses share a phrase.",
    consequence: "Read the repeated phrase across both verses.",
    interpretations: [],
    evidenceIds: ["web-1"],
    limitations: ["Only this selection was reviewed."],
    relatedPassages: [],
  },
];
function providers() {
  return vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/ROM/8"))
      return Response.json({
        translation: { identifier: "web" },
        verses: [
          {
            book_id: "ROM",
            chapter: 8,
            verse: 1,
            text: "No condemnation in Christ.",
          },
        ],
      });
    if (url.hostname === "bible-api.com")
      return Response.json({
        translation: { identifier: "web" },
        verses: [1, 2, 3, 4, 18].map((verse) => ({
          book_id: "JHN",
          chapter: 1,
          verse,
          text:
            verse === 18
              ? "God gave his only Son for the world."
              : `Public WEB verse ${["one", "two", "three", "four"][verse - 1]}`,
        })),
      });
    if (
      url.hostname === "raw.githubusercontent.com" &&
      url.pathname.endsWith("/43.content.json")
    )
      return Response.json([
        {
          content_id: "fixture-note-1",
          reference_id: 43001001,
          version: "fixture-v1",
          title: "A repeated opening",
          media_type: "Text",
          index_reference: "John 1:1",
          language: "eng",
          review_level: "reviewed",
          content:
            '<p>Fixture commentary note.</p><data class="bible-ref" data-start-ref="45008001" data-end-ref="45008001">Romans 8:1</data>',
          associations: {
            passage: [
              {
                start_ref_usfm: "JHN 1:1",
                end_ref_usfm: "JHN 1:1",
                start_ref: "43001001",
                end_ref: "43001001",
              },
            ],
          },
        },
      ]);
    if (
      url.hostname === "raw.githubusercontent.com" &&
      url.pathname.endsWith("/JOH.csv")
    )
      return new Response(
        "chapter,verse,text\n1,1,λογος 3056 {N-NSM} {NA λογος > λόγος}\n1,2,λογος 3056 {N-NSM}\n1,18,ὁ μονογενὴς υἱός {NA ὁ μονογενὴς υἱός > μονογενὴς θεός}\n",
      );
    if (url.pathname.endsWith("strongs-dictionary.xhtml"))
      return new Response(
        '<li id="nt:3056"><i>λόγος</i> A word (synthetic dictionary).</li>',
      );
    throw new Error(`Unexpected retrieval origin: ${url.hostname}`);
  });
}
export async function studyFixture(modules: Parameters<typeof ownerTest>[0]) {
  const t = await ownerTest(modules);
  await t.mutation(api.bible.setPreferences, { enabled: true });
  await saveTestCredential(t, "default_user", "anthropic", "synthetic-key");
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "bible-fixture",
      url: "https://bible-api.com/data/web/JHN/1",
      extractionStatus: "extracted",
      annotationStatus: "pending",
      title: "John 1",
      content,
      contentHtml,
      bible: {
        reference: "John 1",
        translation: "web",
        copyright: "Public domain",
      },
      createdAt: Date.now(),
    }),
  );
  const noteId = await t.run((ctx) =>
    ctx.db.insert("userNotes", {
      userId: "default_user",
      articleId,
      selectedText: "LICENSED_NOTE_SELECTION_CANARY",
      licensedQuote: true,
      content: "<p>PRIVATE_NOTE_CANARY</p>",
      contentPlain: "PRIVATE_NOTE_CANARY",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const markId = await t.run((ctx) =>
    ctx.db.insert("highlights", {
      userId: "default_user",
      articleId,
      kind: "highlight",
      text: "PRIVATE_MARK_CANARY",
      createdAt: Date.now(),
    }),
  );
  const fetch = providers();
  vi.stubGlobal("fetch", fetch);
  const model = vi
    .spyOn(aiModels, "generateObjectWithFallback")
    .mockImplementation(async (options) => ({
      object: { findings },
      modelId: options.targets[0].id,
    }));
  const args = {
    articleId,
    selection,
    sourceHash: await sourceHash(content, contentHtml),
    requestKey: "start-1",
  };
  return { t, args, fetch, model, noteId, markId };
}
