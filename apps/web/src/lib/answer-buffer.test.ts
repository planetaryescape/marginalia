import { afterEach, expect, it, vi } from "vitest";
import { answerBuffer } from "./answer-buffer";

afterEach(() => vi.useRealTimers());
it("coalesces bursts per answer without stealing another answer's cadence", () => {
  vi.useFakeTimers();
  const a = vi.fn(),
    b = vi.fn();
  const first = answerBuffer(a),
    second = answerBuffer(b);
  for (let i = 0; i < 1000; i++) first.schedule();
  second.schedule();
  vi.advanceTimersByTime(31);
  expect(a).not.toHaveBeenCalled();
  expect(b).not.toHaveBeenCalled();
  first.flush();
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(b).toHaveBeenCalledTimes(1);
  first.schedule();
  first.flush();
  first.flush();
  vi.runAllTimers();
  expect(a).toHaveBeenCalledTimes(2);
});
