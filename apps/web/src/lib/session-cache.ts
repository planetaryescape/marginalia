/** A bounded, in-memory cache that forgets everything on session/revision change. */
export class SessionCache<T> {
  generation = 0;
  private scope: string | null = null;
  private revision: string | null | undefined;
  private entries = new Map<string, { at: number; value: T }>();

  constructor(
    private limit: number,
    private ttl: number,
  ) {}

  invalidate() {
    this.entries.clear();
    this.generation++;
  }

  forScope(scope: string | null) {
    if (scope !== this.scope || scope === null) {
      this.entries.clear();
      this.scope = scope;
      this.revision = undefined;
      this.generation++;
    }
  }

  observeRevision(revision: string | null | undefined) {
    // An unmounted subscriber may return pending on remount. Do not discard a
    // same-epoch entry just for registering a listener; callers wait for the
    // initial complete signal before reading/publishing reusable work.
    if (revision === undefined) return;
    if (revision !== this.revision) {
      this.invalidate();
      this.revision = revision;
    }
  }

  get revisionSupported() {
    return (
      this.scope !== null &&
      this.revision !== null &&
      this.revision !== undefined
    );
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (Date.now() - entry.at >= this.ttl) {
      this.entries.delete(key);
      return;
    }
    return entry.value;
  }

  set(key: string, value: T, generation = this.generation) {
    if (generation !== this.generation || this.scope === null) return;
    this.entries.delete(key);
    if (this.entries.size >= this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { at: Date.now(), value });
  }
}
