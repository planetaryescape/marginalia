import { parseArgs } from "node:util";

const ARGUMENT_OPTIONS = {
  generate: { type: "boolean" },
  fixtures: { type: "string" },
  model: { type: "string" },
  "max-calls": { type: "string" },
  "max-estimated-usd": { type: "string" },
  "deadline-ms": { type: "string" },
  "per-call-deadline-ms": { type: "string" },
  "max-output-tokens": { type: "string" },
  out: { type: "string" },
  input: { type: "string" },
} as const;
export type RunnerValues = {
  generate?: boolean;
  fixtures?: string;
  model?: string;
  "max-calls"?: string;
  "max-estimated-usd"?: string;
  "deadline-ms"?: string;
  "per-call-deadline-ms"?: string;
  "max-output-tokens"?: string;
  out?: string;
  input?: string;
};
export function parseCommand(argv: string[]) {
  const [command, ...args] = argv;
  const parsed = parseArgs({
    args,
    options: ARGUMENT_OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  return {
    command,
    values: parsed.values,
    positionals: parsed.positionals,
  };
}
export function required(
  values: RunnerValues,
  name: Exclude<keyof RunnerValues, "generate">,
): string {
  const value = values[name];
  if (!value) throw new Error(`Required: ${name}`);
  return value.trim();
}
export function positiveNumber(
  values: RunnerValues,
  name: Exclude<keyof RunnerValues, "generate">,
): number {
  const value = Number(required(values, name));
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be greater than zero`);
  return value;
}
