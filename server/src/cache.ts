type Entry<T> = { value: T; expires: number };

/**
 * Cache that also de-duplicates in-flight work, so N browser tabs polling the
 * same endpoint cost exactly one Google Analytics API call.
 */
export class TtlCache {
  private entries = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();

  /**
   * `ttlFor` lets a caller shorten the TTL based on what was produced. Per-property
   * failures come back inside a successful payload, so without this a transient
   * outage gets pinned in the cache for the full period.
   */
  async wrap<T>(
    key: string,
    ttlMs: number,
    produce: () => Promise<T>,
    ttlFor?: (value: T) => number,
  ): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const task = produce()
      .then((value) => {
        const ttl = ttlFor ? ttlFor(value) : ttlMs;
        this.entries.set(key, { value, expires: Date.now() + ttl });
        return value;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, task);
    return task;
  }

  clear(): void {
    this.entries.clear();
  }

  /** Drop one user's entries, e.g. after they disconnect Google. */
  clearPrefix(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }
}

export const cache = new TtlCache();
