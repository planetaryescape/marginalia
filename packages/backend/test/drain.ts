import type { FunctionReference } from "convex/server";
import type { ownerTest } from "./owner";

type Runner = Pick<Awaited<ReturnType<typeof ownerTest>>, "run" | "mutation">;

/**
 * Runs the named scheduled mutations by hand, oldest first, until none are
 * pending. Everything else stays queued, so no model call is attempted. Needs
 * fake timers, which keep the scheduler from running jobs on its own.
 */
export async function drain(
  t: Runner,
  handlers: Record<string, FunctionReference<"mutation", "internal">>,
) {
  const done = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(1000),
    );
    const next = jobs
      .filter(
        (j) =>
          j.state.kind === "pending" && !done.has(j._id) && j.name in handlers,
      )
      .sort((a, b) => a._creationTime - b._creationTime)[0];
    if (!next) return;
    done.add(next._id);
    await t.mutation(handlers[next.name], next.args[0] as never);
  }
  throw new Error("Scheduled mutations never finished");
}
