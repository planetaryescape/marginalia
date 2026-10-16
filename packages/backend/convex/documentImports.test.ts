/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startImport } from "../test/imports";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_PDF_BYTES } from "./documentImports";

const modules = import.meta.glob("./**/*.ts");

// Starting an import schedules its action; none of these tests run it
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const rawStart = (c: unknown, storageId: Id<"_storage">) =>
  (
    c as { mutation: (f: never, a: never) => Promise<{ ok: boolean }> }
  ).mutation(
    api.documentImports.start as never,
    { storageId, fileName: "a.pdf" } as never,
  );

const pdf = () => new Blob(["%PDF-1.4"], { type: "application/pdf" });

async function upload(
  t: Awaited<ReturnType<typeof secondReaderTest>>["t"],
  blob: Blob = pdf(),
) {
  return t.run((ctx) => ctx.storage.store(blob));
}

describe("starting an import", () => {
  it("claims the upload for the signed-in reader and shows its steps", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const storageId = await upload(t);
    const started = await startImport(owner, {
      storageId,
      fileName: "C:\\books\\Thinking in Systems.pdf",
    });
    expect(started.ok).toBe(true);

    const row = await t.run((ctx) => ctx.db.query("documentImports").first());
    expect(row).toMatchObject({
      userId: "default_user",
      storageId,
      fileName: "Thinking in Systems.pdf",
      status: "reading",
      step: "text",
    });
    expect(await owner.query(api.documentImports.latest, {})).toMatchObject({
      status: "reading",
      fileName: "Thinking in Systems.pdf",
    });
  });

  it("refuses a file over the size limit, leaving it for the sweep", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const storageId = await upload(
      t,
      new Blob([new Uint8Array(MAX_PDF_BYTES + 1)], {
        type: "application/pdf",
      }),
    );
    const result = await startImport(owner, {
      storageId,
      fileName: "huge.pdf",
    });
    expect(result.ok).toBe(false);
    expect(
      await t.run((ctx) => ctx.db.system.get("_storage", storageId)),
    ).not.toBeNull();
  });

  it("will not let a second reader claim an upload that is already claimed", async () => {
    const { t, owner, reader } = await secondReaderTest(modules);
    const storageId = await upload(t);
    await startImport(owner, {
      storageId,
      fileName: "mine.pdf",
    });
    const stolen = await startImport(reader, {
      storageId,
      fileName: "theirs.pdf",
    });
    expect(stolen.ok).toBe(false);
    // The first reader's file is untouched, and the second has no import
    expect(
      await t.run((ctx) => ctx.db.system.get("_storage", storageId)),
    ).not.toBeNull();
    expect(await reader.query(api.documentImports.latest, {})).toBeNull();
  });

  it("refuses an upload that does not exist", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const storageId = await upload(t);
    await t.run((ctx) => ctx.storage.delete(storageId));
    const result = await startImport(owner, {
      storageId,
      fileName: "gone.pdf",
    });
    expect(result.ok).toBe(false);
  });

  it("allows two imports at once, not a third", async () => {
    const { t, owner } = await secondReaderTest(modules);
    for (const name of ["a", "b"])
      expect(
        (
          await startImport(owner, {
            storageId: await upload(t),
            fileName: `${name}.pdf`,
          })
        ).ok,
      ).toBe(true);
    const third = await upload(t);
    const result = await startImport(owner, {
      storageId: third,
      fileName: "c.pdf",
    });
    expect(result.ok).toBe(false);
    // Left for the sweep: it is not this reader's until their claim succeeds
    expect(
      await t.run((ctx) => ctx.db.system.get("_storage", third)),
    ).not.toBeNull();
  });

  it("counts every active import, however many newer ones have finished", async () => {
    const { t, owner } = await secondReaderTest(modules);
    for (const name of ["a", "b"])
      await startImport(owner, {
        storageId: await upload(t),
        fileName: `${name}.pdf`,
      });
    await t.run(async (ctx) => {
      for (let i = 0; i < 6; i++)
        await ctx.db.insert("documentImports", {
          userId: "default_user",
          storageId: await ctx.storage.store(pdf()),
          fileName: `done${i}.pdf`,
          status: "failed",
          step: "text",
          failure: "scanned",
          createdAt: Date.now() + 1000 + i,
          updatedAt: Date.now(),
        });
    });
    const result = await startImport(owner, {
      storageId: await upload(t),
      fileName: "c.pdf",
    });
    expect(result.ok).toBe(false);
  });

  it("deletes no file on a refusal before the reader's claim has succeeded", async () => {
    const { t, owner, reader } = await secondReaderTest(modules);
    const exists = (id: Id<"_storage">) =>
      t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) !== null);
    // Another reader's unclaimed upload, as the thief would see its ID
    const victims = await upload(t);
    // No grant at all
    expect((await rawStart(reader, victims)).ok).toBe(false);
    expect(await exists(victims)).toBe(true);
    // A grant, but the file is over the size limit
    const big = await upload(
      t,
      new Blob([new Uint8Array(MAX_PDF_BYTES + 1)], {
        type: "application/pdf",
      }),
    );
    await reader.mutation(api.documentImports.generateUploadUrl, {});
    expect((await rawStart(reader, big)).ok).toBe(false);
    expect(await exists(big)).toBe(true);
    // A grant, and two imports already running
    for (const name of ["a", "b"])
      await startImport(owner, {
        storageId: await upload(t),
        fileName: `${name}.pdf`,
      });
    const late = await upload(t);
    await owner.mutation(api.documentImports.generateUploadUrl, {});
    expect((await rawStart(owner, late)).ok).toBe(false);
    expect(await exists(late)).toBe(true);
  });

  it("needs a signed-in reader", async () => {
    const { t } = await secondReaderTest(modules);
    const storageId = await upload(t);
    await expect(
      t.mutation(api.documentImports.start, { storageId, fileName: "x.pdf" }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.documentImports.generateUploadUrl, {}),
    ).rejects.toThrow();
  });

  it("hands a signed-in reader an upload URL", async () => {
    const { owner } = await secondReaderTest(modules);
    expect(
      typeof (await owner.mutation(api.documentImports.generateUploadUrl, {})),
    ).toBe("string");
  });
});

describe("an import's steps belong to its reader", () => {
  it("shows each reader only their own latest import", async () => {
    const { t, owner, reader } = await secondReaderTest(modules);
    await startImport(owner, {
      storageId: await upload(t),
      fileName: "owner.pdf",
    });
    expect(await reader.query(api.documentImports.latest, {})).toBeNull();
    await startImport(reader, {
      storageId: await upload(t),
      fileName: "reader.pdf",
    });
    expect(await reader.query(api.documentImports.latest, {})).toMatchObject({
      fileName: "reader.pdf",
    });
    expect(await owner.query(api.documentImports.latest, {})).toMatchObject({
      fileName: "owner.pdf",
    });
  });

  it("will not clear another reader's import", async () => {
    const { t, owner, reader } = await secondReaderTest(modules);
    await startImport(owner, {
      storageId: await upload(t),
      fileName: "owner.pdf",
    });
    const row = await t.run((ctx) => ctx.db.query("documentImports").first());
    if (!row) throw new Error("no import");
    await t.run((ctx) =>
      ctx.db.patch("documentImports", row._id, {
        status: "failed",
        failure: "scanned",
      }),
    );
    await expect(
      reader.mutation(api.documentImports.dismiss, { importId: row._id }),
    ).rejects.toThrow("Import not found");
    await owner.mutation(api.documentImports.dismiss, { importId: row._id });
    expect(await owner.query(api.documentImports.latest, {})).toBeNull();
  });

  it("shows an import whose action never finished as failed", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await startImport(owner, {
      storageId: await upload(t),
      fileName: "stuck.pdf",
    });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    expect(await owner.query(api.documentImports.latest, {})).toMatchObject({
      status: "failed",
      failure: "unreadable",
    });
  });
});

describe("upload grants", () => {
  const start = rawStart;

  it("refuses a reader who was never given an upload URL, and leaves the file alone", async () => {
    const { t, reader } = await secondReaderTest(modules);
    const storageId = await upload(t);
    const result = await start(reader, storageId);
    expect(result.ok).toBe(false);
    // The file may be another reader's in-flight upload
    expect(
      await t.run((ctx) => ctx.db.system.get("_storage", storageId)),
    ).not.toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("documentImports").first()),
    ).toBeNull();
  });

  it("does not let one reader spend another's grant", async () => {
    const { t, owner, reader } = await secondReaderTest(modules);
    await owner.mutation(api.documentImports.generateUploadUrl, {});
    const storageId = await upload(t);
    expect((await start(reader, storageId)).ok).toBe(false);
    expect((await start(owner, storageId)).ok).toBe(true);
  });

  it("is spent by one import", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await owner.mutation(api.documentImports.generateUploadUrl, {});
    expect((await start(owner, await upload(t))).ok).toBe(true);
    expect((await start(owner, await upload(t))).ok).toBe(false);
  });

  it("expires after an hour", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await owner.mutation(api.documentImports.generateUploadUrl, {});
    const storageId = await upload(t);
    vi.setSystemTime(Date.now() + 61 * 60_000);
    expect((await start(owner, storageId)).ok).toBe(false);
  });
});

describe("removing abandoned uploads", () => {
  const exists = (
    t: Awaited<ReturnType<typeof secondReaderTest>>["t"],
    id: Id<"_storage">,
  ) => t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) !== null);

  it("deletes a file nobody imported after two hours, and keeps one an import refers to", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const orphan = await upload(t);
    const fresh = await upload(t);
    const claimed = await upload(t);
    await startImport(owner, { storageId: claimed, fileName: "a.pdf" });
    vi.setSystemTime(Date.now() + 3 * 60 * 60_000);
    const newer = await upload(t);
    await t.mutation(internal.documentImports.sweepUploads, {});
    expect(await exists(t, orphan)).toBe(false);
    expect(await exists(t, fresh)).toBe(false);
    expect(await exists(t, claimed)).toBe(true);
    expect(await exists(t, newer)).toBe(true);
  });

  it("deletes an oversize file soon after, since it can never be imported", async () => {
    const { t } = await secondReaderTest(modules);
    const big = await upload(
      t,
      new Blob([new Uint8Array(MAX_PDF_BYTES + 1)], {
        type: "application/pdf",
      }),
    );
    const small = await upload(t);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await t.mutation(internal.documentImports.sweepUploads, {});
    expect(await exists(t, big)).toBe(false);
    expect(await exists(t, small)).toBe(true);
  });
});
