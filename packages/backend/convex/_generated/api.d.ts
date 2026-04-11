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
import type * as actions_embedUserNote from "../actions/embedUserNote.js";
import type * as actions_extractArticle from "../actions/extractArticle.js";
import type * as actions_generateAnnotations from "../actions/generateAnnotations.js";
import type * as actions_pollFeeds from "../actions/pollFeeds.js";
import type * as actions_selectArticle from "../actions/selectArticle.js";
import type * as annotations from "../annotations.js";
import type * as articles from "../articles.js";
import type * as crons from "../crons.js";
import type * as feeds from "../feeds.js";
import type * as http from "../http.js";
import type * as lib_aiModels from "../lib/aiModels.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_spacedRepetition from "../lib/spacedRepetition.js";
import type * as lovedArticles from "../lovedArticles.js";
import type * as noteChunks from "../noteChunks.js";
import type * as reflections from "../reflections.js";
import type * as savedArticles from "../savedArticles.js";
import type * as sessions from "../sessions.js";
import type * as stats from "../stats.js";
import type * as userNotes from "../userNotes.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/addArticleByUrl": typeof actions_addArticleByUrl;
  "actions/embedUserNote": typeof actions_embedUserNote;
  "actions/extractArticle": typeof actions_extractArticle;
  "actions/generateAnnotations": typeof actions_generateAnnotations;
  "actions/pollFeeds": typeof actions_pollFeeds;
  "actions/selectArticle": typeof actions_selectArticle;
  annotations: typeof annotations;
  articles: typeof articles;
  crons: typeof crons;
  feeds: typeof feeds;
  http: typeof http;
  "lib/aiModels": typeof lib_aiModels;
  "lib/constants": typeof lib_constants;
  "lib/spacedRepetition": typeof lib_spacedRepetition;
  lovedArticles: typeof lovedArticles;
  noteChunks: typeof noteChunks;
  reflections: typeof reflections;
  savedArticles: typeof savedArticles;
  sessions: typeof sessions;
  stats: typeof stats;
  userNotes: typeof userNotes;
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
