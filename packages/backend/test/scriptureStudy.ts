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
export const content = "1:1 Public WEB verse one\n\n1:2 Public WEB verse two";
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
    if (url.hostname === "bible-api.com")
      return Response.json({
        translation: { identifier: "web" },
        verses: [1, 2].map((verse) => ({
          book_id: "JHN",
          chapter: 1,
          verse,
          text: `Public WEB verse ${verse === 1 ? "one" : "two"}`,
        })),
      });
    if (url.pathname.endsWith("/JOH.csv"))
      return new Response(
        "chapter,verse,text\n1,1,λογος 3056 {N-NSM}\n1,2,λογος 3056 {N-NSM}\n",
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
