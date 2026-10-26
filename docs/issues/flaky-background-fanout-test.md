# The background fan-out test fails now and then

`convex/background.test.ts > background fan-out > pages through many readers and staggers their jobs` failed once in a full backend run on 2026-10-16 at `800263e`. It then passed in three full runs and three runs on its own, with no code change in between. The failing assertion was never captured.

## What has been tried at 8d7408a

Checked against `origin/main` 8d7408a (branch `fix/flaky-fanout`). No failure reproduced, so no code changed.

- 300 sequential runs of `bunx vitest run convex/background.test.ts`, no other load: 300 pass, 0 fail.
- Six full backend suites (`bunx vitest run`) in parallel, each in a loop, with the machine at load average about 600: at least 197 full-suite runs failed. The failures were 5s timeouts in `account`, `isolation`, `access`, `catchUp`, `importPdf` and others. None was in `background.test.ts`, and the exact pass count was not recorded before the loop was stopped.
- 100 sequential runs through `agent-work run -- bunx vitest run convex/background.test.ts --maxWorkers=4`: 100 pass, 0 fail.

## What the test depends on

The test calls `t.finishAllScheduledFunctions(vi.runAllTimers)` with fake timers. convex-test's `finishAllScheduledFunctions` (`node_modules/convex-test/dist/index.js`, around line 1828) pumps timers through at most 10000 `MessageChannel` yields and throws if a scheduled action has not settled by then. That budget is real time, so a slow first import of `pollFeeds` on a loaded machine could in principle exhaust it. This is a theory. No run has shown that error, and no run has captured one.

## Next step

If it fails again, keep the full output. The file is `packages/backend/convex/background.test.ts` at lines 104-126. Record the exact assertion or thrown error, the commit, and the machine load. Check whether the error mentions the 10000 pump limit before changing anything.
