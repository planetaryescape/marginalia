/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startImport } from "../test/imports";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_PDF_BYTES } from "./documentImports";
import { storedSha256AsHex } from "./lib/uploadFingerprint";

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

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

/** What the browser would send for a file: its SHA-256 as hex, and its size. */
async function fingerprintOf(t: Fixture["t"], storageId: Id<"_storage">) {
  const file = await t.run((ctx) => ctx.db.system.get("_storage", storageId));
  if (!file) throw new Error("not in storage");
  return { sha256: storedSha256AsHex(file.sha256) as string, size: file.size };
}

/** Asks for an upload URL for exactly this stored file's content. */
async function grantFor(
  t: Fixture["t"],
  client: unknown,
  storageId: Id<"_storage">,
) {
  await (
    client as { mutation: (f: never, a: never) => Promise<unknown> }
  ).mutation(
    api.documentImports.generateUploadUrl as never,
    (await fingerprintOf(t, storageId)) as never,
  );
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
    // generateUploadUrl would refuse this size, so the grant is written as an
    // older or hand-built request could have left it
    const fingerprint = await fingerprintOf(t, storageId);
    await t.run((ctx) =>
      ctx.db.insert("uploadGrants", {
        userId: "default_user",
        issuedAt: Date.now(),
        ...fingerprint,
      }),
    );
    const result = await rawStart(owner, storageId);
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
    const bigFingerprint = await fingerprintOf(t, big);
    await t.run((ctx) =>
      ctx.db.insert("uploadGrants", {
        userId: "default_user",
        issuedAt: Date.now(),
        ...bigFingerprint,
      }),
    );
    expect((await rawStart(owner, big)).ok).toBe(false);
    expect(await exists(big)).toBe(true);
    // A grant, and two imports already running
    for (const name of ["a", "b"])
      await startImport(owner, {
        storageId: await upload(t),
        fileName: `${name}.pdf`,
      });
    const late = await upload(t);
    await grantFor(t, owner, late);
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
      t.mutation(api.documentImports.generateUploadUrl, {
        ...(await fingerprintOf(t, storageId)),
      }),
    ).rejects.toThrow();
  });

  it("hands a signed-in reader an upload URL", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const fingerprint = await fingerprintOf(t, await upload(t));
    expect(
      typeof (await owner.mutation(
        api.documentImports.generateUploadUrl,
        fingerprint,
      )),
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
  const stored = (t: Fixture["t"], id: Id<"_storage">) =>
    t.run((ctx) => ctx.db.system.get("_storage", id));
  const noImports = (t: Fixture["t"]) =>
    t.run((ctx) => ctx.db.query("documentImports").first());

  it("refuses a reader who was never given an upload URL, and leaves the file alone", async () => {
    const { t, reader } = await secondReaderTest(modules);
    const storageId = await upload(t);
    const result = await start(reader, storageId);
    expect(result.ok).toBe(false);
    // The file may be another reader's in-flight upload
    expect(await stored(t, storageId)).not.toBeNull();
    expect(await noImports(t)).toBeNull();
  });

  it("spends the grant of the reader whose hash and size match the stored file", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const storageId = await upload(t);
    await grantFor(t, owner, storageId);
    expect((await start(owner, storageId)).ok).toBe(true);
    const grants = await t.run((ctx) => ctx.db.query("uploadGrants").collect());
    expect(grants).toHaveLength(1);
    expect(grants[0]?.usedAt).toBeDefined();
  });

  it("matches the right grant when the reader has several", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const other = await upload(t, new Blob(["%PDF-1.7 other"]));
    const mine = await upload(t);
    await grantFor(t, owner, other);
    await grantFor(t, owner, mine);
    expect((await start(owner, mine)).ok).toBe(true);
    const unspent = await t.run(async (ctx) =>
      (await ctx.db.query("uploadGrants").collect()).filter(
        (g) => g.usedAt === undefined,
      ),
    );
    expect(unspent).toHaveLength(1);
    expect(unspent[0]).toMatchObject(await fingerprintOf(t, other));
  });

  it("does not let one reader spend another's grant", async () => {
    const { t, owner, reader } = await secondReaderTest(modules);
    const storageId = await upload(t);
    await grantFor(t, owner, storageId);
    expect((await start(reader, storageId)).ok).toBe(false);
    expect((await start(owner, storageId)).ok).toBe(true);
  });

  it("does not let a reader claim another reader's file with a grant for different content", async () => {
    const { t, owner, reader } = await secondReaderTest(modules);
    // The reader holds a live grant for a file of their own...
    const theirs = await upload(t, new Blob(["%PDF-1.7 theirs"]));
    await grantFor(t, reader, theirs);
    // ...and learns the ID of the owner's finished, unclaimed upload
    const victims = await upload(t);
    await grantFor(t, owner, victims);
    expect((await start(reader, victims)).ok).toBe(false);
    expect(await stored(t, victims)).not.toBeNull();
    expect(await noImports(t)).toBeNull();
    // The owner's claim still works, and the reader's grant is unspent
    expect((await start(owner, victims)).ok).toBe(true);
    expect((await start(reader, theirs)).ok).toBe(true);
  });

  it("refuses a grant with the right hash but the wrong size, leaving the file", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const storageId = await upload(t);
    const { sha256, size } = await fingerprintOf(t, storageId);
    await owner.mutation(api.documentImports.generateUploadUrl, {
      sha256,
      size: size + 1,
    });
    expect((await start(owner, storageId)).ok).toBe(false);
    expect(await stored(t, storageId)).not.toBeNull();
    expect(await noImports(t)).toBeNull();
  });

  it("is spent by one import", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const first = await upload(t);
    await grantFor(t, owner, first);
    expect((await start(owner, first)).ok).toBe(true);
    // A second file with the very same content needs a grant of its own
    const second = await upload(t);
    expect((await start(owner, second)).ok).toBe(false);
    expect(await stored(t, second)).not.toBeNull();
  });

  it("expires after an hour", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const storageId = await upload(t);
    await grantFor(t, owner, storageId);
    vi.setSystemTime(Date.now() + 61 * 60_000);
    expect((await start(owner, storageId)).ok).toBe(false);
    expect(await stored(t, storageId)).not.toBeNull();
  });

  it("tells a reader with a grant from before hashes existed to reload", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const storageId = await upload(t);
    await t.run((ctx) =>
      ctx.db.insert("uploadGrants", {
        userId: "default_user",
        issuedAt: Date.now(),
      }),
    );
    const result = (await start(owner, storageId)) as { error?: string };
    expect(result.error).toMatch(/Reload/);
    expect(await stored(t, storageId)).not.toBeNull();
  });

  it("asks an older client that sends no hash to reload, without recording a grant", async () => {
    const { t, owner } = await secondReaderTest(modules);
    await expect(
      owner.mutation(api.documentImports.generateUploadUrl, {}),
    ).rejects.toThrow(/Reload/);
    expect(
      await t.run((ctx) => ctx.db.query("uploadGrants").first()),
    ).toBeNull();
  });

  it.each([
    ["a short hash", { sha256: "abc", size: 10 }],
    ["an uppercase hash", { sha256: "A".repeat(64), size: 10 }],
    ["a negative size", { sha256: "a".repeat(64), size: -1 }],
    ["a fractional size", { sha256: "a".repeat(64), size: 1.5 }],
    ["an over-limit size", { sha256: "a".repeat(64), size: MAX_PDF_BYTES + 1 }],
  ])("refuses %s without recording a grant", async (_name, args) => {
    const { t, owner } = await secondReaderTest(modules);
    await expect(
      owner.mutation(api.documentImports.generateUploadUrl, args),
    ).rejects.toThrow();
    expect(
      await t.run((ctx) => ctx.db.query("uploadGrants").first()),
    ).toBeNull();
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
