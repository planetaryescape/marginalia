import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { storedSha256AsHex } from "../convex/lib/uploadFingerprint";

type Client = {
  mutation: (fn: never, args: never) => Promise<unknown>;
  run: <T>(
    fn: (ctx: {
      db: {
        system: {
          get: (
            table: "_storage",
            id: Id<"_storage">,
          ) => Promise<{ sha256: string; size: number } | null>;
        };
      };
    }) => Promise<T>,
  ) => Promise<T>;
};

/**
 * Starts an import the way the browser does: ask for an upload URL with the
 * file's hash and size, which records the grant, then hand over the stored
 * file. The fingerprint is read from storage, as the browser's own hash of the
 * same bytes would match it.
 */
export async function startImport(
  client: unknown,
  args: { storageId: Id<"_storage">; fileName: string },
) {
  const c = client as Client;
  const file = await c.run((ctx) =>
    ctx.db.system.get("_storage", args.storageId),
  );
  // A file that never arrived has no fingerprint; start reports that itself
  await c.mutation(
    api.documentImports.generateUploadUrl as never,
    {
      sha256: file ? storedSha256AsHex(file.sha256) : "0".repeat(64),
      size: file?.size ?? 0,
    } as never,
  );
  return (await c.mutation(
    api.documentImports.start as never,
    args as never,
  )) as
    | { ok: true; importId: Id<"documentImports"> }
    | { ok: false; error: string };
}
