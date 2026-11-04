import { getConvexSize } from "convex/values";
import type { TestConvex } from "convex-test";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { aliasProjection } from "../convex/lib/tagAliases";
import { vectorOverflow, vectorProjection } from "../convex/lib/tagVectors";
import { tagProjection } from "../convex/lib/tagVocabulary";
import type schema from "../convex/schema";

type TestBackend = TestConvex<typeof schema>;
type TreeNode = Pick<
  Doc<"tagVocabulary">,
  "_id" | "tagId" | "count" | "key" | "sourceCreationTime"
>;

export async function seedBudgetVocabulary(
  t: TestBackend,
  userId: string,
  tagIds: Id<"tags">[],
  withAliases: boolean,
) {
  const nodes: TreeNode[] = [];
  let overflow = 0;
  let aliasOverflow = 0;
  for (let start = 0; start < tagIds.length; start += 20) {
    const batch = await t.run(async (ctx) => {
      const result: TreeNode[] = [];
      for (const tagId of tagIds.slice(start, start + 20)) {
        const tag = await ctx.db.get(tagId);
        if (!tag) throw new Error("Missing canonical fixture tag");
        const projection = tagProjection(tag);
        const {
          name,
          aliases,
          text,
          missing,
          active,
          count,
          overflow: over,
          ...identity
        } = projection;
        overflow += Number(over);
        const payloadId = await ctx.db.insert("tagVocabularyPayloads", {
          ...identity,
          name,
          aliases,
          text,
          missing,
        });
        const _id = await ctx.db.insert("tagVocabulary", {
          ...identity,
          active,
          count,
          overflow: over,
          payloadId,
          left: null,
          right: null,
          height: 1,
        });
        result.push({ _id, ...identity, count });
        if (withAliases) {
          const projected = aliasProjection(tag);
          aliasOverflow += Number(projected.overflow);
          await ctx.db.insert("tagAliasSources", {
            userId,
            tagId,
            overflow: projected.overflow,
          });
          for (const alias of projected.aliases)
            await ctx.db.insert("tagAliases", {
              userId,
              tagId,
              key: tag.key,
              alias,
              sourceCreationTime: tag._creationTime,
            });
        }
      }
      return result;
    });
    nodes.push(...batch);
  }
  nodes.sort(
    (a, b) =>
      b.count - a.count ||
      a.key.localeCompare(b.key) ||
      a.sourceCreationTime - b.sourceCreationTime ||
      (a.tagId < b.tagId ? -1 : a.tagId === b.tagId ? 0 : 1),
  );
  await t.run(async (ctx) => {
    async function build(
      start: number,
      end: number,
    ): Promise<{ id: Id<"tagVocabulary"> | null; height: number }> {
      if (start >= end) return { id: null, height: 0 };
      const middle = Math.floor((start + end) / 2);
      const node = nodes[middle];
      if (!node) throw new Error("Missing fixture vocabulary node");
      const left = await build(start, middle);
      const right = await build(middle + 1, end);
      const height = 1 + Math.max(left.height, right.height);
      await ctx.db.patch(node._id, {
        left: left.id,
        right: right.id,
        height,
      });
      return { id: node._id, height };
    }
    const root = await build(0, nodes.length);
    await ctx.db.insert("tagVocabularyState", {
      userId,
      root: root.id,
      overflow,
      ready: true,
      cursor: null,
    });
    if (withAliases)
      await ctx.db.insert("tagAliasState", {
        userId,
        ready: false,
        backfilled: true,
        overflow: aliasOverflow,
        cursor: null,
      });
  });
}

export async function seedBudgetVectors(
  t: TestBackend,
  userId: string,
  tagIds: Id<"tags">[],
) {
  let vectorBytes = 0;
  let overflow = 0;
  for (let start = 0; start < tagIds.length; start += 20)
    await t.run(async (ctx) => {
      for (const tagId of tagIds.slice(start, start + 20)) {
        const tag = await ctx.db.get(tagId);
        if (!tag) throw new Error("Missing canonical fixture tag");
        const projection = vectorProjection(tag);
        const size = getConvexSize(projection) + 256;
        const over = vectorOverflow(tag);
        await ctx.db.insert("tagVectors", projection);
        await ctx.db.insert("tagVectorSources", {
          userId,
          tagId,
          vectorBytes: size,
          overflow: over,
        });
        vectorBytes += size;
        overflow += Number(over);
      }
    });
  await t.run((ctx) =>
    ctx.db.insert("tagVectorState", {
      userId,
      ready: false,
      backfilled: true,
      cursor: null,
      count: tagIds.length,
      vectorBytes,
      overflow,
      epoch: tagIds.length,
    }),
  );
}
