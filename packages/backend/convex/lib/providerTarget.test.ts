import { expect, expectTypeOf, it, vi } from "vitest";
import { resolveTarget } from "./providerTarget";

it("resolves once, removes the lease callback and preserves model metadata", async () => {
  const resolveApiKey = vi.fn(async () => "rotated");
  const target = { id: "model", apiKey: "placeholder", resolveApiKey } as const;
  const resolved = await resolveTarget(target);
  expectTypeOf(resolved.apiKey).toEqualTypeOf<string>();
  expectTypeOf(resolved.id).toEqualTypeOf<"model">();
  expect(resolved).toEqual({ id: "model", apiKey: "rotated" });
  expect(await resolveTarget(resolved)).toEqual(resolved);
  expect(resolveApiKey).toHaveBeenCalledTimes(1);
});
