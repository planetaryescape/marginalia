/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { addReader } from "../test/owner";
import authSchema from "./betterAuth/schema";
import { metadataTriggers } from "./lib/metadataTriggers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("generic retained reporting projections", () => {
  it("tracks insert/patch/replace/delete, owner/article/date moves, clears and retained inactive writes", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    t.registerComponent(
      "betterAuth",
      authSchema,
      import.meta.glob("./betterAuth/**/*.ts"),
    );
    const a = await addReader(t, { email: "report-writer-a@example.com" });
    const b = await addReader(t, {
      email: "report-writer-b@example.com",
      status: "disabled",
    });
    await t.run(async (ctx) => {
      const { db } = metadataTriggers.wrapDB(ctx);
      const articleId = await db.insert("articles", {
        userId: a.libraryId,
        guid: "one",
        url: "https://example.com",
        title: "One",
        extractionStatus: "pending",
        annotationStatus: "pending",
        createdAt: 1,
      });
      const otherArticle = await db.insert("articles", {
        userId: b.libraryId,
        guid: "two",
        url: "https://example.com/2",
        title: "Two",
        extractionStatus: "pending",
        annotationStatus: "pending",
        createdAt: 1,
      });
      const fields = {
        userId: a.libraryId,
        articleId,
        selectedText: "passage",
        content: "html",
        contentPlain: "\n\t",
        createdAt: 10,
        updatedAt: 10,
      };
      const noteId = await db.insert("userNotes", fields);
      const reflectionFields = {
        userId: a.libraryId,
        articleId,
        strongestPoint: "",
        weakestAssumption: "",
        credibleCounterview: "",
        questionForYou: "",
        createdAt: 1,
      };
      const reflectionId = await db.insert("reflections", reflectionFields);
      const note = () =>
        ctx.db
          .query("noteReportingMetadata")
          .withIndex("by_noteId", (q) => q.eq("noteId", noteId))
          .unique();
      const reflection = () =>
        ctx.db
          .query("reflectionReportingMetadata")
          .withIndex("by_reflectionId", (q) =>
            q.eq("reflectionId", reflectionId),
          )
          .unique();
      expect(await note()).toMatchObject({
        nonblank: false,
        createdAt: 10,
        articleId,
        userId: a.libraryId,
      });
      expect(await reflection()).toBeNull();
      await db.patch(noteId, {
        contentPlain: "\u00a0idea\u00a0",
        createdAt: 20,
        articleId: otherArticle,
        userId: b.libraryId,
      });
      await db.patch(reflectionId, {
        userResponse: " yes ",
        respondedAt: 20,
        articleId: otherArticle,
        userId: b.libraryId,
      });
      expect(await note()).toMatchObject({
        nonblank: true,
        createdAt: 20,
        articleId: otherArticle,
        userId: b.libraryId,
      });
      expect(await reflection()).toMatchObject({
        nonblank: true,
        respondedAt: 20,
        userId: b.libraryId,
      });
      expect(
        await ctx.db
          .query("noteReportingMetadata")
          .withIndex("by_userId", (q) => q.eq("userId", a.libraryId))
          .collect(),
      ).toEqual([]);
      await db.replace(noteId, { ...fields, contentPlain: "", createdAt: 30 });
      await db.replace(reflectionId, {
        ...reflectionFields,
        userResponse: "",
        respondedAt: 30,
      });
      expect(await note()).toMatchObject({
        nonblank: false,
        createdAt: 30,
        articleId,
        userId: a.libraryId,
      });
      expect(await reflection()).toMatchObject({
        nonblank: false,
        respondedAt: 30,
      });
      // Saved-empty and absent are identical only for reporting, NOT for M02.
      expect((await ctx.db.get(reflectionId))?.userResponse).toBe("");
      await db.patch(reflectionId, {
        userResponse: undefined,
        respondedAt: undefined,
      });
      expect(await reflection()).toBeNull();
      await db.delete(noteId);
      await db.delete(reflectionId);
      expect(await note()).toBeNull();
      expect(await reflection()).toBeNull();
      // Late callbacks cannot recreate metadata for an absent/deleting library.
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", b.libraryId))
        .unique();
      if (!reader) throw new Error("Missing fixture reader");
      await ctx.db.patch(reader._id, { deletingAt: 1 });
      await db.insert("userNotes", { ...fields, userId: b.libraryId });
      await db.insert("reflections", {
        ...reflectionFields,
        userId: b.libraryId,
        respondedAt: 1,
      });
      await db.insert("userNotes", { ...fields, userId: "absent-library" });
      await db.insert("reflections", {
        ...reflectionFields,
        userId: "absent-library",
        respondedAt: 1,
      });
      expect(await ctx.db.query("noteReportingMetadata").collect()).toEqual([]);
      expect(
        await ctx.db.query("reflectionReportingMetadata").collect(),
      ).toEqual([]);
    });
  });
});
