export function archiveFixture() {
  const article = {
    _id: "source-article",
    userId: "source-reader",
    guid: "reader:document-1",
    readerDocumentId: "document-1",
    url: "https://example.com/reading",
    title: "An archived article",
    author: "Author",
    content: "An archived article body.",
    contentHtml: "<p>An archived article body.</p>",
    wordCount: 4,
    estimatedReadMinutes: 1,
    createdAt: 1000,
    extractionStatus: "extracted",
    annotationStatus: "skipped",
    skipReason: "no_provider",
  };
  const highlight = {
    _id: "source-highlight",
    userId: article.userId,
    articleId: article._id,
    kind: "highlight",
    text: "archived article",
    source: "reader",
    readerHighlightId: "reader-highlight-1",
    createdAt: 2000,
  };
  return {
    format: "marginalia-account-export",
    version: 1,
    source: "https://source.example.com",
    completedAt: "2026-11-24T06:10:12.701Z",
    data: {
      articles: [
        {
          articleId: article._id,
          article,
          relations: {
            "annotations:listByArticle": [],
            "summaries:getByArticle": null,
            "reflections:getByArticle": null,
            "impressions:getByArticle": null,
            "companionThreads:listByArticle": [],
            "readingActivity:furthestPlace": { percent: 40, paragraphIndex: 2 },
            "scriptureStudy:listByArticle": null,
          },
        },
      ],
      fullHighlights: [{ articleId: article._id, rows: [highlight] }],
      "highlights:listMine": [highlight],
      "sessions:listRecentInteractions": [
        {
          _id: "source-interaction",
          userId: article.userId,
          articleId: article._id,
          action: "opened",
          createdAt: 2000,
        },
      ],
      "feeds:list": [],
      "providerCredentials:list": [],
      "impressions:listRecent": [],
      "savedArticles:page": [],
      "lovedArticles:page": [],
      "userNotes:listPreviews": [],
      "companionThreads:listKeptPreviews": [],
      "dictionary:page": [],
      "scriptureKeeps:page": [],
      notes: [],
      "userSettings:getModels": {
        selected: { annotations: null, deep: null, quick: null },
      },
      "userSettings:getSpeechVoice": { selected: "fixture-voice" },
      "bible:preferences": {
        enabled: false,
        scope: "articles",
        translation: "web",
      },
    },
  };
}
