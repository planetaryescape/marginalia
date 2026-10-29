# Compare Deep Study prompts

Use this harness to compare the frozen baseline prompt with the candidate prompt on the same public passage and evidence snapshots. It evaluates synthesis only: it does not exercise the live reader’s model setting, private notes, or full source retrieval and allocation path. Because both arms receive the same frozen evidence, the comparison cannot show whether evidence selection improved.

## Inspect the public fixtures

The checked-in catalog contains nine cases: five calibration cases and four held-out cases. They cover Colossians 2 as a whole and in ranges, Psalm 13, Proverbs 26:4–5, Jonah 4, Matthew 13:1–23 and Acts 21:6. Each case records a question, contrary claims, evidence boundaries and scoring criteria. Snapshots pin public WEB text and retrieved source records, along with input, evidence, prompt and schema hashes.

Inspect the snapshots before running generation:

```sh
bun scripts/deep-study/runner.ts inspect
```

The output prints each fixture’s split, reference, hashes, prompt and source-policy versions, source revision, license, locator and content hash. `inspect` validates the saved hashes and active schema. If you add a case, `prepare [fixture-id]` fetches public sources and writes a snapshot only if that file does not already exist; it refuses to overwrite a snapshot. Review the case and snapshot before using either arm.

## Run a paired generation

Generation requires the explicit `--generate` flag and an `OPENROUTER_API_KEY` environment variable. Use an OpenRouter model already present in the app routing catalog. Set an approved estimated-cost ceiling, call limit and deadlines for the run. Never put the key in a command argument or fixture.

For example, after exporting the credential in your shell, this runs both arms on one calibration fixture with explicit caps:

```sh
bun scripts/deep-study/runner.ts run --generate \
  --fixtures colossians-2-whole \
  --model openrouter:openai/gpt-6-luna \
  --max-calls 4 \
  --max-estimated-usd 1 \
  --deadline-ms 300000 \
  --per-call-deadline-ms 90000 \
  --max-output-tokens 6000 \
  --out /tmp/deep-study-pilot
```

The runner checks listed OpenRouter pricing before generation and stops if its conservative reservation exceeds `--max-estimated-usd`. A paired fixture reserves up to four model calls: two per arm, including a possible repair attempt. The output cap must match production’s 6,000-token limit. The runner alternates which arm goes first across fixtures and writes a JSONL record for every answer or failure. Records include the evaluation and snapshot identities, prompt and schema hashes, requested and resolved model IDs when available, call limits, pricing estimate, token telemetry and validation result. `actualBilledUsd` is always null; these records do not query provider billing.

The command prints the JSONL path when the run completes. It writes one record for each attempted arm. Dispatch errors and deadline failures are recorded as failures, not answers, and must not be scored as evidence of reasoning quality.

## Blind and score the answers

Pair a completed run file offline:

```sh
bun scripts/deep-study/runner.ts pair \
  --input /tmp/deep-study-pilot/run-<timestamp>.jsonl \
  --out /tmp/deep-study-pilot/blind
```

The output directory contains `blind-pairs.md`, `score-template.md` and `blind-key.json`. Give reviewers the first two files and keep the key separate until they finish. The pair hides arm labels while showing the same question and evidence supplied to both answers. The template asks reviewers to mark material claims supported, partly supported or unsupported, score the case criteria, and compare reasoning separately from source support. Ties and two unacceptable answers are valid outcomes. Scoring is manual; the harness does not calculate a quality score or provide an unblind command.

Record the fixture IDs and splits, evaluation commit, snapshot hashes, model, run limits and any dispatch failures with the completed scorecards. Do not treat calibration cases as held-out results. A prompt comparison over frozen evidence says nothing about the live retrieval path or a reader’s configured model.

## First pilot status

The first paired attempt on 2026-10-29 did not produce answers: both arms for `colossians-2-whole` ended in `dispatch_failed` before response or token-usage telemetry was recorded. The saved credential checks returned HTTP 401; an alternate credential lookup is pending. No reasoning or source-support comparison can be made from this run.
