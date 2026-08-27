/**
 * Per-property refresh scheduling.
 *
 * The naive model refreshed every property for every active user on a fixed
 * interval. That is the wrong shape: most properties are idle most of the time,
 * and a property that is failing gets hammered just as hard as one that works.
 *
 * Three rules fix it:
 *   - a property with no live viewers is backed off progressively,
 *   - a failing property is backed off exponentially,
 *   - remaining API quota, which Google reports on every response, overrides
 *     both when it runs low.
 */

export type Quota = {
  /** Remaining realtime tokens for this property this hour. */
  tokensPerHourRemaining?: number;
  tokensPerHourConsumed?: number;
};

export type Outcome = {
  activeUsers: number;
  error?: string;
  quota?: Quota;
};

/**
 * Idle multipliers against the base interval: 15s, 15s, 30s, 1m, then 2m.
 *
 * Capped at 2 minutes deliberately. A longer ceiling would save more quota, but
 * it also sets how long a brand new viewer stays invisible on a quiet property -
 * and a dashboard that calls itself "live" cannot be five minutes behind. Real
 * quota pressure is handled below, where it is measured rather than guessed.
 */
const IDLE_MULTIPLIERS = [1, 1, 2, 4, 8];
/** Error backoff is absolute, not a multiplier - a broken property can wait. */
const ERROR_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 900_000];
/** Below this share of hourly tokens left, slow everything down. */
const QUOTA_LOW = 0.15;
const QUOTA_CRITICAL = 0.05;

type State = {
  nextDue: number;
  idleStreak: number;
  errorStreak: number;
};

export class RefreshScheduler {
  private state = new Map<string, State>();

  constructor(private readonly baseMs: number) {}

  /** Properties never seen before are always due. */
  isDue(key: string, now = Date.now()): boolean {
    const entry = this.state.get(key);
    return !entry || entry.nextDue <= now;
  }

  record(key: string, outcome: Outcome, now = Date.now()): void {
    const entry = this.state.get(key) ?? { nextDue: 0, idleStreak: 0, errorStreak: 0 };

    if (outcome.error) {
      // Index first, then increment, so the first failure waits the shortest
      // step rather than skipping it.
      const step = Math.min(entry.errorStreak, ERROR_BACKOFF_MS.length - 1);
      entry.nextDue = now + ERROR_BACKOFF_MS[step];
      entry.errorStreak += 1;
      entry.idleStreak = 0;
      this.state.set(key, entry);
      return;
    }

    entry.errorStreak = 0;

    let interval: number;
    if (outcome.activeUsers > 0) {
      // Someone is on the site: full speed, immediately. Ramping down from a
      // stale idle streak here would leave a live property minutes behind.
      entry.idleStreak = 0;
      interval = this.baseMs;
    } else {
      const step = Math.min(entry.idleStreak, IDLE_MULTIPLIERS.length - 1);
      interval = this.baseMs * IDLE_MULTIPLIERS[step];
      entry.idleStreak += 1;
    }

    const remaining = quotaFraction(outcome.quota);
    if (remaining !== null) {
      if (remaining <= QUOTA_CRITICAL) interval = Math.max(interval, this.baseMs * 40);
      else if (remaining <= QUOTA_LOW) interval = Math.max(interval, this.baseMs * 10);
    }

    entry.nextDue = now + interval;
    this.state.set(key, entry);
  }

  /** Drop state for properties the user can no longer see. */
  retain(keys: Set<string>): void {
    for (const key of this.state.keys()) if (!keys.has(key)) this.state.delete(key);
  }

  /** Diagnostics only. */
  describe(key: string): State | null {
    return this.state.get(key) ?? null;
  }

  get size(): number {
    return this.state.size;
  }
}

function quotaFraction(quota: Quota | undefined): number | null {
  if (!quota) return null;
  const remaining = quota.tokensPerHourRemaining;
  const consumed = quota.tokensPerHourConsumed ?? 0;
  if (typeof remaining !== "number") return null;

  const total = remaining + consumed;
  if (total <= 0) return null;
  return remaining / total;
}
