/** One buffer per answer/request. Completion, error and Stop explicitly flush. */
export function answerBuffer(paint: () => void, cadenceMs = 32) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    pending = false;
    paint();
  };
  return {
    schedule() {
      pending = true;
      timer ??= setTimeout(flush, cadenceMs);
    },
    flush,
  };
}
