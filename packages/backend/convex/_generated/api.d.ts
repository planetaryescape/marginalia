/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as account from "../account.js";
import type * as actions_addArticleByUrl from "../actions/addArticleByUrl.js";
import type * as actions_annotateUnit from "../actions/annotateUnit.js";
import type * as actions_embedArticle from "../actions/embedArticle.js";
import type * as actions_embedReaderActivity from "../actions/embedReaderActivity.js";
import type * as actions_embedTags from "../actions/embedTags.js";
import type * as actions_embedUserNote from "../actions/embedUserNote.js";
import type * as actions_explainIdeaEdge from "../actions/explainIdeaEdge.js";
import type * as actions_extractArticle from "../actions/extractArticle.js";
import type * as actions_generateAnnotations from "../actions/generateAnnotations.js";
import type * as actions_ideaNeighbours from "../actions/ideaNeighbours.js";
import type * as actions_importPdf from "../actions/importPdf.js";
import type * as actions_indexBook from "../actions/indexBook.js";
import type * as actions_indexLibraryArticle from "../actions/indexLibraryArticle.js";
import type * as actions_ingestExternal from "../actions/ingestExternal.js";
import type * as actions_pollFeeds from "../actions/pollFeeds.js";
import type * as actions_readAlongside from "../actions/readAlongside.js";
import type * as actions_readwiseSync from "../actions/readwiseSync.js";
import type * as actions_summarize from "../actions/summarize.js";
import type * as alongside from "../alongside.js";
import type * as annotations from "../annotations.js";
import type * as apiTokens from "../apiTokens.js";
import type * as articleExtraction from "../articleExtraction.js";
import type * as articleImportKeys from "../articleImportKeys.js";
import type * as articleMetadata from "../articleMetadata.js";
import type * as articlePassages from "../articlePassages.js";
import type * as articles from "../articles.js";
import type * as auth from "../auth.js";
import type * as background from "../background.js";
import type * as bookIndex from "../bookIndex.js";
import type * as books from "../books.js";
import type * as catchUp from "../catchUp.js";
import type * as chatgpt from "../chatgpt.js";
import type * as citedArticles from "../citedArticles.js";
import type * as companionThreads from "../companionThreads.js";
import type * as crons from "../crons.js";
import type * as dictionary from "../dictionary.js";
import type * as documentImports from "../documentImports.js";
import type * as externalApi from "../externalApi.js";
import type * as feedStats from "../feedStats.js";
import type * as feedSuggestions from "../feedSuggestions.js";
import type * as feeds from "../feeds.js";
import type * as functions from "../functions.js";
import type * as highlights from "../highlights.js";
import type * as home from "../home.js";
import type * as http from "../http.js";
import type * as ideaEdgeReasons from "../ideaEdgeReasons.js";
import type * as ideaGraph from "../ideaGraph.js";
import type * as ideaLinks from "../ideaLinks.js";
import type * as impressions from "../impressions.js";
import type * as lib_aiModels from "../lib/aiModels.js";
import type * as lib_alongsidePrompt from "../lib/alongsidePrompt.js";
import type * as lib_annotationGate from "../lib/annotationGate.js";
import type * as lib_annotationKinds from "../lib/annotationKinds.js";
import type * as lib_annotationOutputBudget from "../lib/annotationOutputBudget.js";
import type * as lib_annotationPolicy from "../lib/annotationPolicy.js";
import type * as lib_answerStream from "../lib/answerStream.js";
import type * as lib_articleAsk from "../lib/articleAsk.js";
import type * as lib_articleCard from "../lib/articleCard.js";
import type * as lib_articleIdentity from "../lib/articleIdentity.js";
import type * as lib_articleMetadata from "../lib/articleMetadata.js";
import type * as lib_articleOutline from "../lib/articleOutline.js";
import type * as lib_articleUrl from "../lib/articleUrl.js";
import type * as lib_bookAsk from "../lib/bookAsk.js";
import type * as lib_bookIndex from "../lib/bookIndex.js";
import type * as lib_bookPicks from "../lib/bookPicks.js";
import type * as lib_chatgpt from "../lib/chatgpt.js";
import type * as lib_chatgptResponses from "../lib/chatgptResponses.js";
import type * as lib_chatgptTokens from "../lib/chatgptTokens.js";
import type * as lib_companionStream from "../lib/companionStream.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_cors from "../lib/cors.js";
import type * as lib_dictionaryIndex from "../lib/dictionaryIndex.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_externalApi from "../lib/externalApi.js";
import type * as lib_feedArticleCount from "../lib/feedArticleCount.js";
import type * as lib_feedRemoval from "../lib/feedRemoval.js";
import type * as lib_ideaGraph from "../lib/ideaGraph.js";
import type * as lib_ideaNodes from "../lib/ideaNodes.js";
import type * as lib_ideaSignals from "../lib/ideaSignals.js";
import type * as lib_importContent from "../lib/importContent.js";
import type * as lib_importJobs from "../lib/importJobs.js";
import type * as lib_ingest from "../lib/ingest.js";
import type * as lib_library from "../lib/library.js";
import type * as lib_librarySearch from "../lib/librarySearch.js";
import type * as lib_localContext from "../lib/localContext.js";
import type * as lib_marginaliaContext from "../lib/marginaliaContext.js";
import type * as lib_marginaliaFingerprint from "../lib/marginaliaFingerprint.js";
import type * as lib_marginaliaRecallBudget from "../lib/marginaliaRecallBudget.js";
import type * as lib_markColours from "../lib/markColours.js";
import type * as lib_metadataTriggers from "../lib/metadataTriggers.js";
import type * as lib_ownerTransition from "../lib/ownerTransition.js";
import type * as lib_pdf_extract from "../lib/pdf/extract.js";
import type * as lib_pdf_sections from "../lib/pdf/sections.js";
import type * as lib_pdf_structure from "../lib/pdf/structure.js";
import type * as lib_pdf_title from "../lib/pdf/title.js";
import type * as lib_preparedRepresentation from "../lib/preparedRepresentation.js";
import type * as lib_providerKeys from "../lib/providerKeys.js";
import type * as lib_providerTarget from "../lib/providerTarget.js";
import type * as lib_providers from "../lib/providers.js";
import type * as lib_queryEmbeddingCache from "../lib/queryEmbeddingCache.js";
import type * as lib_readerAI from "../lib/readerAI.js";
import type * as lib_readerArticle from "../lib/readerArticle.js";
import type * as lib_readerBodies from "../lib/readerBodies.js";
import type * as lib_readingActivity from "../lib/readingActivity.js";
import type * as lib_readingCompanion from "../lib/readingCompanion.js";
import type * as lib_readingRoom from "../lib/readingRoom.js";
import type * as lib_readingSections from "../lib/readingSections.js";
import type * as lib_readingSession from "../lib/readingSession.js";
import type * as lib_readwise from "../lib/readwise.js";
import type * as lib_requestControl from "../lib/requestControl.js";
import type * as lib_router from "../lib/router.js";
import type * as lib_serverTiming from "../lib/serverTiming.js";
import type * as lib_shelfArticle from "../lib/shelfArticle.js";
import type * as lib_shelfCounts from "../lib/shelfCounts.js";
import type * as lib_spacedRepetition from "../lib/spacedRepetition.js";
import type * as lib_sse from "../lib/sse.js";
import type * as lib_statsPeriod from "../lib/statsPeriod.js";
import type * as lib_tagMatching from "../lib/tagMatching.js";
import type * as lib_taste from "../lib/taste.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_unfinishedBooks from "../lib/unfinishedBooks.js";
import type * as lib_unreadQueue from "../lib/unreadQueue.js";
import type * as lib_vaultUpload from "../lib/vaultUpload.js";
import type * as library from "../library.js";
import type * as libraryIndex from "../libraryIndex.js";
import type * as limits from "../limits.js";
import type * as lookups from "../lookups.js";
import type * as lovedArticles from "../lovedArticles.js";
import type * as marginaliaRecall from "../marginaliaRecall.js";
import type * as noteChunks from "../noteChunks.js";
import type * as notesSearch from "../notesSearch.js";
import type * as preAnnotate from "../preAnnotate.js";
import type * as preparedArticles from "../preparedArticles.js";
import type * as providerCredentials from "../providerCredentials.js";
import type * as queryEmbeddings from "../queryEmbeddings.js";
import type * as readerBootstrap from "../readerBootstrap.js";
import type * as readers from "../readers.js";
import type * as readingActivity from "../readingActivity.js";
import type * as readingHabits from "../readingHabits.js";
import type * as readingQueue from "../readingQueue.js";
import type * as readingRoomBackfill from "../readingRoomBackfill.js";
import type * as readwise from "../readwise.js";
import type * as readwiseSyncState from "../readwiseSyncState.js";
import type * as reannotateBackfill from "../reannotateBackfill.js";
import type * as reflections from "../reflections.js";
import type * as savedArticles from "../savedArticles.js";
import type * as sessions from "../sessions.js";
import type * as stats from "../stats.js";
import type * as suggestions from "../suggestions.js";
import type * as summaries from "../summaries.js";
import type * as tagMerge from "../tagMerge.js";
import type * as tags from "../tags.js";
import type * as taste from "../taste.js";
import type * as titleSearch from "../titleSearch.js";
import type * as userNotes from "../userNotes.js";
import type * as userSettings from "../userSettings.js";
import type * as vaultFiles from "../vaultFiles.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  account: typeof account;
  "actions/addArticleByUrl": typeof actions_addArticleByUrl;
  "actions/annotateUnit": typeof actions_annotateUnit;
  "actions/embedArticle": typeof actions_embedArticle;
  "actions/embedReaderActivity": typeof actions_embedReaderActivity;
  "actions/embedTags": typeof actions_embedTags;
  "actions/embedUserNote": typeof actions_embedUserNote;
  "actions/explainIdeaEdge": typeof actions_explainIdeaEdge;
  "actions/extractArticle": typeof actions_extractArticle;
  "actions/generateAnnotations": typeof actions_generateAnnotations;
  "actions/ideaNeighbours": typeof actions_ideaNeighbours;
  "actions/importPdf": typeof actions_importPdf;
  "actions/indexBook": typeof actions_indexBook;
  "actions/indexLibraryArticle": typeof actions_indexLibraryArticle;
  "actions/ingestExternal": typeof actions_ingestExternal;
  "actions/pollFeeds": typeof actions_pollFeeds;
  "actions/readAlongside": typeof actions_readAlongside;
  "actions/readwiseSync": typeof actions_readwiseSync;
  "actions/summarize": typeof actions_summarize;
  alongside: typeof alongside;
  annotations: typeof annotations;
  apiTokens: typeof apiTokens;
  articleExtraction: typeof articleExtraction;
  articleImportKeys: typeof articleImportKeys;
  articleMetadata: typeof articleMetadata;
  articlePassages: typeof articlePassages;
  articles: typeof articles;
  auth: typeof auth;
  background: typeof background;
  bookIndex: typeof bookIndex;
  books: typeof books;
  catchUp: typeof catchUp;
  chatgpt: typeof chatgpt;
  citedArticles: typeof citedArticles;
  companionThreads: typeof companionThreads;
  crons: typeof crons;
  dictionary: typeof dictionary;
  documentImports: typeof documentImports;
  externalApi: typeof externalApi;
  feedStats: typeof feedStats;
  feedSuggestions: typeof feedSuggestions;
  feeds: typeof feeds;
  functions: typeof functions;
  highlights: typeof highlights;
  home: typeof home;
  http: typeof http;
  ideaEdgeReasons: typeof ideaEdgeReasons;
  ideaGraph: typeof ideaGraph;
  ideaLinks: typeof ideaLinks;
  impressions: typeof impressions;
  "lib/aiModels": typeof lib_aiModels;
  "lib/alongsidePrompt": typeof lib_alongsidePrompt;
  "lib/annotationGate": typeof lib_annotationGate;
  "lib/annotationKinds": typeof lib_annotationKinds;
  "lib/annotationOutputBudget": typeof lib_annotationOutputBudget;
  "lib/annotationPolicy": typeof lib_annotationPolicy;
  "lib/answerStream": typeof lib_answerStream;
  "lib/articleAsk": typeof lib_articleAsk;
  "lib/articleCard": typeof lib_articleCard;
  "lib/articleIdentity": typeof lib_articleIdentity;
  "lib/articleMetadata": typeof lib_articleMetadata;
  "lib/articleOutline": typeof lib_articleOutline;
  "lib/articleUrl": typeof lib_articleUrl;
  "lib/bookAsk": typeof lib_bookAsk;
  "lib/bookIndex": typeof lib_bookIndex;
  "lib/bookPicks": typeof lib_bookPicks;
  "lib/chatgpt": typeof lib_chatgpt;
  "lib/chatgptResponses": typeof lib_chatgptResponses;
  "lib/chatgptTokens": typeof lib_chatgptTokens;
  "lib/companionStream": typeof lib_companionStream;
  "lib/constants": typeof lib_constants;
  "lib/cors": typeof lib_cors;
  "lib/dictionaryIndex": typeof lib_dictionaryIndex;
  "lib/embeddings": typeof lib_embeddings;
  "lib/externalApi": typeof lib_externalApi;
  "lib/feedArticleCount": typeof lib_feedArticleCount;
  "lib/feedRemoval": typeof lib_feedRemoval;
  "lib/ideaGraph": typeof lib_ideaGraph;
  "lib/ideaNodes": typeof lib_ideaNodes;
  "lib/ideaSignals": typeof lib_ideaSignals;
  "lib/importContent": typeof lib_importContent;
  "lib/importJobs": typeof lib_importJobs;
  "lib/ingest": typeof lib_ingest;
  "lib/library": typeof lib_library;
  "lib/librarySearch": typeof lib_librarySearch;
  "lib/localContext": typeof lib_localContext;
  "lib/marginaliaContext": typeof lib_marginaliaContext;
  "lib/marginaliaFingerprint": typeof lib_marginaliaFingerprint;
  "lib/marginaliaRecallBudget": typeof lib_marginaliaRecallBudget;
  "lib/markColours": typeof lib_markColours;
  "lib/metadataTriggers": typeof lib_metadataTriggers;
  "lib/ownerTransition": typeof lib_ownerTransition;
  "lib/pdf/extract": typeof lib_pdf_extract;
  "lib/pdf/sections": typeof lib_pdf_sections;
  "lib/pdf/structure": typeof lib_pdf_structure;
  "lib/pdf/title": typeof lib_pdf_title;
  "lib/preparedRepresentation": typeof lib_preparedRepresentation;
  "lib/providerKeys": typeof lib_providerKeys;
  "lib/providerTarget": typeof lib_providerTarget;
  "lib/providers": typeof lib_providers;
  "lib/queryEmbeddingCache": typeof lib_queryEmbeddingCache;
  "lib/readerAI": typeof lib_readerAI;
  "lib/readerArticle": typeof lib_readerArticle;
  "lib/readerBodies": typeof lib_readerBodies;
  "lib/readingActivity": typeof lib_readingActivity;
  "lib/readingCompanion": typeof lib_readingCompanion;
  "lib/readingRoom": typeof lib_readingRoom;
  "lib/readingSections": typeof lib_readingSections;
  "lib/readingSession": typeof lib_readingSession;
  "lib/readwise": typeof lib_readwise;
  "lib/requestControl": typeof lib_requestControl;
  "lib/router": typeof lib_router;
  "lib/serverTiming": typeof lib_serverTiming;
  "lib/shelfArticle": typeof lib_shelfArticle;
  "lib/shelfCounts": typeof lib_shelfCounts;
  "lib/spacedRepetition": typeof lib_spacedRepetition;
  "lib/sse": typeof lib_sse;
  "lib/statsPeriod": typeof lib_statsPeriod;
  "lib/tagMatching": typeof lib_tagMatching;
  "lib/taste": typeof lib_taste;
  "lib/tokens": typeof lib_tokens;
  "lib/unfinishedBooks": typeof lib_unfinishedBooks;
  "lib/unreadQueue": typeof lib_unreadQueue;
  "lib/vaultUpload": typeof lib_vaultUpload;
  library: typeof library;
  libraryIndex: typeof libraryIndex;
  limits: typeof limits;
  lookups: typeof lookups;
  lovedArticles: typeof lovedArticles;
  marginaliaRecall: typeof marginaliaRecall;
  noteChunks: typeof noteChunks;
  notesSearch: typeof notesSearch;
  preAnnotate: typeof preAnnotate;
  preparedArticles: typeof preparedArticles;
  providerCredentials: typeof providerCredentials;
  queryEmbeddings: typeof queryEmbeddings;
  readerBootstrap: typeof readerBootstrap;
  readers: typeof readers;
  readingActivity: typeof readingActivity;
  readingHabits: typeof readingHabits;
  readingQueue: typeof readingQueue;
  readingRoomBackfill: typeof readingRoomBackfill;
  readwise: typeof readwise;
  readwiseSyncState: typeof readwiseSyncState;
  reannotateBackfill: typeof reannotateBackfill;
  reflections: typeof reflections;
  savedArticles: typeof savedArticles;
  sessions: typeof sessions;
  stats: typeof stats;
  suggestions: typeof suggestions;
  summaries: typeof summaries;
  tagMerge: typeof tagMerge;
  tags: typeof tags;
  taste: typeof taste;
  titleSearch: typeof titleSearch;
  userNotes: typeof userNotes;
  userSettings: typeof userSettings;
  vaultFiles: typeof vaultFiles;
  waitlist: typeof waitlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};
