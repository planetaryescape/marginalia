import { expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const formats: ("epub" | "pdf" | undefined)[] = ["epub", "pdf", undefined];

it.each(formats)("expires a reading %s import only once", async (format) => {
  const { t } = await secondReaderTest(modules);
  const { importId, storageId } = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(["synthetic-secret-bytes"]),
    );
    const importId = await ctx.db.insert("documentImports", {
      userId: "default_user",
      storageId,
      fileName: "synthetic-secret-filename",
      title: "synthetic-secret-title",
      author: "synthetic-secret-author",
      format,
      status: "reading",
      step: "text",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { importId, storageId };
  });
  await t.mutation(internal.documentImports.expire, { importId });
  const expired = await t.run((ctx) => ctx.db.get(importId));
  expect(expired).toMatchObject({ status: "failed", failure: "too_slow" });
  expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  await t.mutation(internal.documentImports.expire, { importId });
  expect(await t.run((ctx) => ctx.db.get(importId))).toEqual(expired);
});

const terminalStatuses = ["ready", "failed"] as const;

it.each(
  terminalStatuses,
)("does not expire an EPUB that is already %s", async (status) => {
  const { t } = await secondReaderTest(modules);
  const { importId, storageId } = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["generated"]));
    const importId = await ctx.db.insert("documentImports", {
      userId: "default_user",
      storageId,
      fileName: "generated.epub",
      format: "epub",
      status,
      step: "text",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { importId, storageId };
  });
  const before = await t.run((ctx) => ctx.db.get(importId));
  await t.mutation(internal.documentImports.expire, { importId });
  expect(await t.run((ctx) => ctx.db.get(importId))).toEqual(before);
  expect(await t.run((ctx) => ctx.db.system.get(storageId))).not.toBeNull();
});
