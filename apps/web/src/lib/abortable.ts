/** Stop waiting without cancelling work (such as a token refresh) shared by others. */
export function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}
