# The background fan-out test fails now and then

`convex/background.test.ts > background fan-out > pages through many readers and staggers their jobs` failed once in a full backend run on 2026-10-16 at `800263e`. It then passed in three full runs and three runs on its own, with no code change in between.

The test checks stagger timing across many readers, so the likely cause is its fake timers or scheduled-function ordering under a loaded machine. That is a hypothesis: the failing run's assertion output wasn't captured.

Next step: run it in a loop (`for i in $(seq 50); do bunx vitest run convex/background.test.ts; done`) under load. Capture the assertion that fails and make the test independent of wall-clock ordering.
