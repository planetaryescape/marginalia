import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

type Client = {
  mutation: (fn: never, args: never) => Promise<unknown>;
};

/**
 * Starts an import the way the browser does: ask for an upload URL, which
 * records the grant, then hand over the stored file.
 */
export async function startImport(
  client: unknown,
  args: { storageId: Id<"_storage">; fileName: string },
) {
  const c = client as Client;
  await c.mutation(api.documentImports.generateUploadUrl as never, {} as never);
  return (await c.mutation(
    api.documentImports.start as never,
    args as never,
  )) as
    | { ok: true; importId: Id<"documentImports"> }
    | { ok: false; error: string };
}
