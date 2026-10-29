import { parseCommand, required } from "./cliArgs";
import { inspect, prepare } from "./fixtures";
import { run } from "./generation";
import { pair } from "./scorecard";

function help() {
  console.log(
    `Deep Study public fixture runner\n\nPrepare immutable snapshots (public source fetches only):\n  bun scripts/deep-study/runner.ts prepare [fixture-id]\n  bun scripts/deep-study/runner.ts inspect [fixture-id ...]\n\nExplicit paired generation (up to two dispatches per arm per fixture):\n  OPENROUTER_API_KEY=… bun scripts/deep-study/runner.ts run --generate --fixtures id,id --model openrouter:catalog/model --max-calls N --max-estimated-usd USD --deadline-ms N --per-call-deadline-ms N --max-output-tokens N --out DIR\n\nBlind offline comparison:\n  bun scripts/deep-study/runner.ts pair --input run.jsonl --out DIR`,
  );
}

async function main() {
  const { command, values, positionals } = parseCommand(process.argv.slice(2));
  if (command === "prepare") return prepare(positionals[0]);
  if (command === "inspect") return inspect(positionals);
  if (command === "run") return run(values);
  if (command === "pair")
    return pair(required(values, "input"), required(values, "out"));
  help();
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown runner failure";
  console.error(message);
  process.exitCode = 1;
});
