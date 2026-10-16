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
import type * as actions_embedArticle from "../actions/embedArticle.js";
import type * as actions_embedReaderActivity from "../actions/embedReaderActivity.js";
import type * as actions_embedTags from "../actions/embedTags.js";
import type * as actions_embedUserNote from "../actions/embedUserNote.js";
import type * as actions_explainIdeaEdge from "../actions/explainIdeaEdge.js";
import type * as actions_extractArticle from "../actions/extractArticle.js";
import type * as actions_generateAnnotations from "../actions/generateAnnotations.js";
import type * as actions_ideaNeighbours from "../actions/ideaNeighbours.js";
import type * as actions_ingestExternal from "../actions/ingestExternal.js";
import type * as actions_pollFeeds from "../actions/pollFeeds.js";
import type * as actions_readwiseSync from "../actions/readwiseSync.js";
import type * as actions_selectArticle from "../actions/selectArticle.js";
import type * as actions_summarize from "../actions/summarize.js";
import type * as annotations from "../annotations.js";
import type * as apiTokens from "../apiTokens.js";
import type * as articles from "../articles.js";
import type * as auth from "../auth.js";
import type * as background from "../background.js";
import type * as catchUp from "../catchUp.js";
import type * as chatgpt from "../chatgpt.js";
import type * as companionThreads from "../companionThreads.js";
import type * as crons from "../crons.js";
import type * as dictionary from "../dictionary.js";
import type * as externalApi from "../externalApi.js";
import type * as feedStats from "../feedStats.js";
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
import type * as lib_annotationGate from "../lib/annotationGate.js";
import type * as lib_annotationKinds from "../lib/annotationKinds.js";
import type * as lib_annotationPolicy from "../lib/annotationPolicy.js";
import type * as lib_articleUrl from "../lib/articleUrl.js";
import type * as lib_chatgpt from "../lib/chatgpt.js";
import type * as lib_chatgptResponses from "../lib/chatgptResponses.js";
import type * as lib_chatgptTokens from "../lib/chatgptTokens.js";
import type * as lib_companionStream from "../lib/companionStream.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_externalApi from "../lib/externalApi.js";
import type * as lib_feedRemoval from "../lib/feedRemoval.js";
import type * as lib_ideaGraph from "../lib/ideaGraph.js";
import type * as lib_ideaNodes from "../lib/ideaNodes.js";
import type * as lib_ideaSignals from "../lib/ideaSignals.js";
import type * as lib_ingest from "../lib/ingest.js";
import type * as lib_library from "../lib/library.js";
import type * as lib_librarySearch from "../lib/librarySearch.js";
import type * as lib_marginaliaContext from "../lib/marginaliaContext.js";
import type * as lib_ownerTransition from "../lib/ownerTransition.js";
import type * as lib_providerKeys from "../lib/providerKeys.js";
import type * as lib_providers from "../lib/providers.js";
import type * as lib_readerAI from "../lib/readerAI.js";
import type * as lib_readingActivity from "../lib/readingActivity.js";
import type * as lib_readingCompanion from "../lib/readingCompanion.js";
import type * as lib_readingRoom from "../lib/readingRoom.js";
import type * as lib_readwise from "../lib/readwise.js";
import type * as lib_router from "../lib/router.js";
import type * as lib_serverTiming from "../lib/serverTiming.js";
import type * as lib_spacedRepetition from "../lib/spacedRepetition.js";
import type * as lib_sse from "../lib/sse.js";
import type * as lib_statsPeriod from "../lib/statsPeriod.js";
import type * as lib_tagMatching from "../lib/tagMatching.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_unreadQueue from "../lib/unreadQueue.js";
import type * as lib_vaultUpload from "../lib/vaultUpload.js";
import type * as library from "../library.js";
import type * as limits from "../limits.js";
import type * as lookups from "../lookups.js";
import type * as lovedArticles from "../lovedArticles.js";
import type * as noteChunks from "../noteChunks.js";
import type * as providerCredentials from "../providerCredentials.js";
import type * as readers from "../readers.js";
import type * as readingActivity from "../readingActivity.js";
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
import type * as tags from "../tags.js";
import type * as userNotes from "../userNotes.js";
import type * as userSettings from "../userSettings.js";
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
  "actions/embedArticle": typeof actions_embedArticle;
  "actions/embedReaderActivity": typeof actions_embedReaderActivity;
  "actions/embedTags": typeof actions_embedTags;
  "actions/embedUserNote": typeof actions_embedUserNote;
  "actions/explainIdeaEdge": typeof actions_explainIdeaEdge;
  "actions/extractArticle": typeof actions_extractArticle;
  "actions/generateAnnotations": typeof actions_generateAnnotations;
  "actions/ideaNeighbours": typeof actions_ideaNeighbours;
  "actions/ingestExternal": typeof actions_ingestExternal;
  "actions/pollFeeds": typeof actions_pollFeeds;
  "actions/readwiseSync": typeof actions_readwiseSync;
  "actions/selectArticle": typeof actions_selectArticle;
  "actions/summarize": typeof actions_summarize;
  annotations: typeof annotations;
  apiTokens: typeof apiTokens;
  articles: typeof articles;
  auth: typeof auth;
  background: typeof background;
  catchUp: typeof catchUp;
  chatgpt: typeof chatgpt;
  companionThreads: typeof companionThreads;
  crons: typeof crons;
  dictionary: typeof dictionary;
  externalApi: typeof externalApi;
  feedStats: typeof feedStats;
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
  "lib/annotationGate": typeof lib_annotationGate;
  "lib/annotationKinds": typeof lib_annotationKinds;
  "lib/annotationPolicy": typeof lib_annotationPolicy;
  "lib/articleUrl": typeof lib_articleUrl;
  "lib/chatgpt": typeof lib_chatgpt;
  "lib/chatgptResponses": typeof lib_chatgptResponses;
  "lib/chatgptTokens": typeof lib_chatgptTokens;
  "lib/companionStream": typeof lib_companionStream;
  "lib/constants": typeof lib_constants;
  "lib/embeddings": typeof lib_embeddings;
  "lib/externalApi": typeof lib_externalApi;
  "lib/feedRemoval": typeof lib_feedRemoval;
  "lib/ideaGraph": typeof lib_ideaGraph;
  "lib/ideaNodes": typeof lib_ideaNodes;
  "lib/ideaSignals": typeof lib_ideaSignals;
  "lib/ingest": typeof lib_ingest;
  "lib/library": typeof lib_library;
  "lib/librarySearch": typeof lib_librarySearch;
  "lib/marginaliaContext": typeof lib_marginaliaContext;
  "lib/ownerTransition": typeof lib_ownerTransition;
  "lib/providerKeys": typeof lib_providerKeys;
  "lib/providers": typeof lib_providers;
  "lib/readerAI": typeof lib_readerAI;
  "lib/readingActivity": typeof lib_readingActivity;
  "lib/readingCompanion": typeof lib_readingCompanion;
  "lib/readingRoom": typeof lib_readingRoom;
  "lib/readwise": typeof lib_readwise;
  "lib/router": typeof lib_router;
  "lib/serverTiming": typeof lib_serverTiming;
  "lib/spacedRepetition": typeof lib_spacedRepetition;
  "lib/sse": typeof lib_sse;
  "lib/statsPeriod": typeof lib_statsPeriod;
  "lib/tagMatching": typeof lib_tagMatching;
  "lib/tokens": typeof lib_tokens;
  "lib/unreadQueue": typeof lib_unreadQueue;
  "lib/vaultUpload": typeof lib_vaultUpload;
  library: typeof library;
  limits: typeof limits;
  lookups: typeof lookups;
  lovedArticles: typeof lovedArticles;
  noteChunks: typeof noteChunks;
  providerCredentials: typeof providerCredentials;
  readers: typeof readers;
  readingActivity: typeof readingActivity;
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
  tags: typeof tags;
  userNotes: typeof userNotes;
  userSettings: typeof userSettings;
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
