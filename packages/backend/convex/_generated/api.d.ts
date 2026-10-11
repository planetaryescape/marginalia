/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_addArticleByUrl from "../actions/addArticleByUrl.js";
import type * as actions_embedReaderActivity from "../actions/embedReaderActivity.js";
import type * as actions_embedUserNote from "../actions/embedUserNote.js";
import type * as actions_extractArticle from "../actions/extractArticle.js";
import type * as actions_generateAnnotations from "../actions/generateAnnotations.js";
import type * as actions_pollFeeds from "../actions/pollFeeds.js";
import type * as actions_readwiseSync from "../actions/readwiseSync.js";
import type * as actions_selectArticle from "../actions/selectArticle.js";
import type * as actions_summarize from "../actions/summarize.js";
import type * as annotations from "../annotations.js";
import type * as articles from "../articles.js";
import type * as companionThreads from "../companionThreads.js";
import type * as crons from "../crons.js";
import type * as feeds from "../feeds.js";
import type * as highlights from "../highlights.js";
import type * as home from "../home.js";
import type * as http from "../http.js";
import type * as impressions from "../impressions.js";
import type * as lib_aiModels from "../lib/aiModels.js";
import type * as lib_companionStream from "../lib/companionStream.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_ingest from "../lib/ingest.js";
import type * as lib_library from "../lib/library.js";
import type * as lib_librarySearch from "../lib/librarySearch.js";
import type * as lib_marginaliaContext from "../lib/marginaliaContext.js";
import type * as lib_openrouter from "../lib/openrouter.js";
import type * as lib_readingCompanion from "../lib/readingCompanion.js";
import type * as lib_readwise from "../lib/readwise.js";
import type * as lib_spacedRepetition from "../lib/spacedRepetition.js";
import type * as library from "../library.js";
import type * as lovedArticles from "../lovedArticles.js";
import type * as noteChunks from "../noteChunks.js";
import type * as readwise from "../readwise.js";
import type * as reflections from "../reflections.js";
import type * as savedArticles from "../savedArticles.js";
import type * as sessions from "../sessions.js";
import type * as stats from "../stats.js";
import type * as summaries from "../summaries.js";
import type * as userNotes from "../userNotes.js";
import type * as userSettings from "../userSettings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/addArticleByUrl": typeof actions_addArticleByUrl;
  "actions/embedReaderActivity": typeof actions_embedReaderActivity;
  "actions/embedUserNote": typeof actions_embedUserNote;
  "actions/extractArticle": typeof actions_extractArticle;
  "actions/generateAnnotations": typeof actions_generateAnnotations;
  "actions/pollFeeds": typeof actions_pollFeeds;
  "actions/readwiseSync": typeof actions_readwiseSync;
  "actions/selectArticle": typeof actions_selectArticle;
  "actions/summarize": typeof actions_summarize;
  annotations: typeof annotations;
  articles: typeof articles;
  companionThreads: typeof companionThreads;
  crons: typeof crons;
  feeds: typeof feeds;
  highlights: typeof highlights;
  home: typeof home;
  http: typeof http;
  impressions: typeof impressions;
  "lib/aiModels": typeof lib_aiModels;
  "lib/companionStream": typeof lib_companionStream;
  "lib/constants": typeof lib_constants;
  "lib/embeddings": typeof lib_embeddings;
  "lib/ingest": typeof lib_ingest;
  "lib/library": typeof lib_library;
  "lib/librarySearch": typeof lib_librarySearch;
  "lib/marginaliaContext": typeof lib_marginaliaContext;
  "lib/openrouter": typeof lib_openrouter;
  "lib/readingCompanion": typeof lib_readingCompanion;
  "lib/readwise": typeof lib_readwise;
  "lib/spacedRepetition": typeof lib_spacedRepetition;
  library: typeof library;
  lovedArticles: typeof lovedArticles;
  noteChunks: typeof noteChunks;
  readwise: typeof readwise;
  reflections: typeof reflections;
  savedArticles: typeof savedArticles;
  sessions: typeof sessions;
  stats: typeof stats;
  summaries: typeof summaries;
  userNotes: typeof userNotes;
  userSettings: typeof userSettings;
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

export declare const components: {};
