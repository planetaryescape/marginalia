import { getConvexSize } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { metadataLibraryRetained } from "./shelfCounts";
import {
  equalEmbedding,
  TAG_SOURCE_BYTES,
  TAG_VECTOR_BYTES,
  TAG_VECTOR_COUNT,
  vectorOverflow,
  vectorProjection,
  vectorState,
} from "./tagVectors";

type Proof = NonNullable<Doc<"tagVectorState">["proof"]>;
const token = (state: Doc<"tagVectorState">, run: number) =>
  `${state._id}:${run}`;
const validCounter = (n: number) => Number.isSafeInteger(n) && n >= 0;
const eligible = (state: Doc<"tagVectorState">) =>
  state.backfilled &&
  state.overflow === 0 &&
  validCounter(state.count) &&
  state.count <= TAG_VECTOR_COUNT &&
  validCounter(state.vectorBytes) &&
  state.vectorBytes <= TAG_VECTOR_BYTES &&
  validCounter(state.epoch ?? 0);

function result(state: Doc<"tagVectorState">, proof: Proof) {
  return {
    stateId: state._id,
    token: token(state, proof.run),
    step: proof.step,
    phase: proof.phase,
  };
}

/** Operator recovery after a lost response; never exposes canonical payloads. */
export async function tagVectorProofStatus(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
) {
  if (!(await metadataLibraryRetained(ctx, userId))) return null;
  const state = await vectorState(ctx, userId);
  if (!state) return null;
  return {
    stateId: state._id,
    run: state.proof?.run ?? 0,
    proof: state.proof ? result(state, state.proof) : null,
    ready: state.ready,
    changed: !!state.proof && state.proof.epoch !== (state.epoch ?? 0),
  };
}

/** Compare-and-start: retries with the old expectedRun cannot restart progress.
 * The state ID binds tokens across purge/recreation; run never wraps or resets. */
export async function beginTagVectorProof(
  ctx: MutationCtx,
  userId: string,
  expectedStateId: Id<"tagVectorState">,
  expectedRun: number,
) {
  if (!(await metadataLibraryRetained(ctx, userId))) return null;
  const state = await vectorState(ctx, userId);
  if (
    !state ||
    state._id !== expectedStateId ||
    !eligible(state) ||
    !validCounter(expectedRun) ||
    expectedRun !== (state.proof?.run ?? 0) ||
    expectedRun >= Number.MAX_SAFE_INTEGER
  )
    return null;
  const proof: Proof = {
    run: expectedRun + 1,
    epoch: state.epoch ?? 0,
    step: 0,
    phase: "canonical",
    cursor: null,
    count: 0,
    vectorBytes: 0,
    checkedCount: 0,
    checkedBytes: 0,
  };
  await ctx.db.patch(state._id, { ready: false, proof });
  return result(state, proof);
}

/** One paginate maximum, including empty phases. Only actual canonical equality
 * and actual per-owner sidecar cardinalities can finish the proof. No state
 * count is treated as evidence of membership. */
export async function stepTagVectorProof(
  ctx: MutationCtx,
  userId: string,
  runToken: string,
  expectedStep: number,
) {
  if (!(await metadataLibraryRetained(ctx, userId))) return null;
  const state = await vectorState(ctx, userId);
  const current = state?.proof;
  if (
    !state ||
    !current ||
    token(state, current.run) !== runToken ||
    current.step !== expectedStep ||
    current.phase === "failed" ||
    current.phase === "complete"
  )
    return null;
  const proof = { ...current, step: current.step + 1 };
  const finish = async (failed = false) => {
    if (failed) proof.phase = "failed";
    await ctx.db.patch(state._id, { proof, ready: proof.phase === "complete" });
    return result(state, proof);
  };
  if (
    !eligible(state) ||
    (state.epoch ?? 0) !== proof.epoch ||
    !validCounter(proof.step) ||
    proof.step > 3 * (TAG_VECTOR_COUNT + 1) + 3
  )
    return finish(true);
  const options = {
    cursor: proof.cursor,
    numItems: 32,
    maximumRowsRead: 32,
    maximumBytesRead: 1_048_576,
  };
  if (proof.phase === "canonical") {
    const page = await ctx.db
      .query("tags")
      .withIndex("by_user_key", (q) => q.eq("userId", userId))
      .paginate(options);
    // Native paginate can overshoot its target by one full document. Canonical
    // eligibility is checked before joining. Count every returned byte, even
    // for malformed rows; stop before another pair can use the reserve.
    let readBytes = page.page.reduce(
      (sum, tag) => sum + getConvexSize(tag) + 256,
      0,
    );
    for (const tag of page.page) {
      if (
        getConvexSize(tag) > TAG_SOURCE_BYTES ||
        vectorOverflow(tag) ||
        readBytes > 4_000_000
      )
        return finish(true);
      const rows = await ctx.db
        .query("tagVectors")
        .withIndex("by_tagId", (q) => q.eq("tagId", tag._id))
        .take(2);
      const sources = await ctx.db
        .query("tagVectorSources")
        .withIndex("by_tagId", (q) => q.eq("tagId", tag._id))
        .take(2);
      // Four at-most-1MiB documents fit even if all four are corrupt/foreign.
      readBytes += [...rows, ...sources].reduce(
        (sum, row) => sum + getConvexSize(row) + 256,
        0,
      );
      const row = rows[0];
      const source = sources[0];
      const size = getConvexSize(vectorProjection(tag)) + 256;
      if (
        rows.length !== 1 ||
        sources.length !== 1 ||
        !row ||
        !source ||
        row.userId !== userId ||
        row.key !== tag.key ||
        row.sourceCreationTime !== tag._creationTime ||
        !equalEmbedding(row.embedding, tag.embedding) ||
        source.userId !== userId ||
        source.overflow ||
        source.vectorBytes !== size
      )
        return finish(true);
      proof.count++;
      proof.vectorBytes += size;
      if (
        proof.count > TAG_VECTOR_COUNT ||
        proof.vectorBytes > TAG_VECTOR_BYTES
      )
        return finish(true);
    }
    proof.cursor = page.continueCursor;
    if (page.isDone) {
      if (
        proof.count !== state.count ||
        proof.vectorBytes !== state.vectorBytes
      )
        return finish(true);
      proof.phase = "vectors";
      proof.cursor = null;
    }
  } else {
    // No paired joins in final phases: the stable epoch preserves all canonical
    // comparisons. Each canonical ID had exactly one owner-correct row. Equal
    // actual owner cardinalities therefore exclude every extra/foreign/stale ID.
    const page =
      proof.phase === "vectors"
        ? await ctx.db
            .query("tagVectors")
            .withIndex(
              "by_userId_and_key_and_sourceCreationTime_and_tagId",
              (q) => q.eq("userId", userId),
            )
            .paginate(options)
        : await ctx.db
            .query("tagVectorSources")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .paginate(options);
    for (const row of page.page) {
      proof.checkedCount++;
      if ("vectorBytes" in row) {
        if (!validCounter(row.vectorBytes) || row.overflow) return finish(true);
        proof.checkedBytes += row.vectorBytes;
      } else {
        const { _id, _creationTime, ...fields } = row;
        proof.checkedBytes += getConvexSize(fields) + 256;
      }
      if (
        proof.checkedCount > proof.count ||
        proof.checkedBytes > proof.vectorBytes
      )
        return finish(true);
    }
    proof.cursor = page.continueCursor;
    if (page.isDone) {
      if (
        proof.checkedCount !== proof.count ||
        proof.checkedBytes !== proof.vectorBytes
      )
        return finish(true);
      proof.phase = proof.phase === "vectors" ? "sources" : "complete";
      proof.cursor = null;
      proof.checkedCount = 0;
      proof.checkedBytes = 0;
    }
  }
  return finish();
}
