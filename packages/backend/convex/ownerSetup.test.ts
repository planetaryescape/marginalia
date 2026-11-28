import { afterEach, expect, it, vi } from "vitest";
import { ownerTest, readerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

it("exposes only whether an owner has claimed this deployment", async () => {
  const t = readerTest(modules);
  expect(await t.query(api.ownerSetup.availability, {})).toEqual({
    claimed: false,
  });
  expect(await t.query(api.ownerSetup.status, {})).toEqual({
    step: "not-owner",
  });
  const owner = await ownerTest(modules);
  expect(await owner.query(api.ownerSetup.availability, {})).toEqual({
    claimed: true,
  });
});

it("prepares an expiring setup link without revealing or storing its plaintext token", async () => {
  vi.stubEnv("SITE_URL", "https://reader.example.com");
  const t = readerTest(modules);
  expect(
    await t.mutation(internal.ownerSetup.prepare, {
      hash: "a".repeat(64),
      expiresAt: Date.now() + 600_000,
    }),
  ).toEqual({ kind: "unclaimed", url: "https://reader.example.com/setup" });
  expect(
    await t.run((ctx) => ctx.db.query("readerAccess").unique()),
  ).toMatchObject({
    key: "owner",
    setupHash: "a".repeat(64),
  });
  expect(await t.query(api.ownerSetup.availability, {})).toEqual({
    claimed: false,
  });
});

it("rejects missing origins and overlong setup lifetimes before creating a claim", async () => {
  const t = readerTest(modules);
  vi.stubEnv("SITE_URL", "");
  await expect(
    t.mutation(internal.ownerSetup.prepare, {
      hash: "a".repeat(64),
      expiresAt: Date.now() + 600_000,
    }),
  ).rejects.toThrow("SITE_URL");
  vi.stubEnv("SITE_URL", "https://reader.example.com");
  await expect(
    t.mutation(internal.ownerSetup.prepare, {
      hash: "a".repeat(64),
      expiresAt: Date.now() + 3600_000,
    }),
  ).rejects.toThrow("fifteen minutes");
  expect(
    await t.run((ctx) => ctx.db.query("readerAccess").unique()),
  ).toBeNull();
});

it("sends an existing owner to sign-in and setup without replacing their account or progress", async () => {
  vi.stubEnv("SITE_URL", "https://reader.example.com");
  const t = await ownerTest(modules);
  const before = await t.run((ctx) => ctx.db.query("readerAccess").unique());
  expect(
    await t.mutation(internal.ownerSetup.prepare, {
      hash: "b".repeat(64),
      expiresAt: Date.now() + 600_000,
    }),
  ).toEqual({ kind: "claimed", url: "https://reader.example.com/setup" });
  expect(await t.run((ctx) => ctx.db.query("readerAccess").unique())).toEqual(
    before,
  );
});

it("leaves established owners alone until they explicitly start setup", async () => {
  const t = await ownerTest(modules);
  expect(await t.query(api.ownerSetup.status, {})).toEqual({
    step: "available",
  });
  await t.mutation(api.ownerSetup.begin, {});
  expect(await t.query(api.ownerSetup.status, {})).toEqual({
    step: "security",
  });
});

it("persists setup progress across sessions and makes retries harmless", async () => {
  const t = await ownerTest(modules);
  await expect(t.mutation(api.ownerSetup.finish, {})).rejects.toThrow(
    "sign-in options",
  );
  await t.mutation(api.ownerSetup.begin, {});
  await t.mutation(api.ownerSetup.reviewSecurity, {});
  await t.mutation(api.ownerSetup.begin, {});
  expect(await t.query(api.ownerSetup.status, {})).toEqual({ step: "library" });
  await t.mutation(api.ownerSetup.finish, {});
  const before = await t.run((ctx) => ctx.db.query("readerAccess").unique());
  await t.mutation(api.ownerSetup.finish, {});
  await t.mutation(api.ownerSetup.reviewSecurity, {});
  await t.mutation(api.ownerSetup.begin, {});
  expect(await t.query(api.ownerSetup.status, {})).toEqual({
    step: "complete",
  });
  expect(await t.run((ctx) => ctx.db.query("readerAccess").unique())).toEqual(
    before,
  );
});

it("denies setup changes to invited readers and anonymous visitors", async () => {
  const { t, owner, reader } = await secondReaderTest(modules);
  for (const client of [t, reader]) {
    expect(await client.query(api.ownerSetup.status, {})).toEqual({
      step: "not-owner",
    });
    for (const fn of [
      api.ownerSetup.begin,
      api.ownerSetup.reviewSecurity,
      api.ownerSetup.finish,
    ])
      await expect(client.mutation(fn, {})).rejects.toThrow(
        "Only the reader owner",
      );
  }
  expect(await owner.query(api.ownerSetup.status, {})).toEqual({
    step: "available",
  });
});
