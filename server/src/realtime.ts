import { env } from "./env.js";
import { fetchPropertyRealtime } from "./gaClient.js";
import { RefreshScheduler } from "./scheduler.js";
import type { MapPoint, Property, RealtimePayload, RealtimeProperty } from "./types.js";

/**
 * Decides which properties actually need a call to Google, and reuses the last
 * known figures for the rest.
 *
 * Previously every poll refreshed every property for every viewer. With N users
 * and M properties that is N x M x 2 requests per interval, whether or not
 * anything changed. Now an idle or failing property backs off on its own, and a
 * busy one still refreshes at full speed.
 */

type Snapshot = {
  summary: RealtimeProperty;
  points: MapPoint[];
  fetchedAt: number;
};

const scheduler = new RefreshScheduler(env.realtimeTtl);
const snapshots = new Map<string, Snapshot>();

const keyFor = (userId: string, propertyId: string) => userId + ":" + propertyId;

/** Bounded concurrency - Google caps concurrent Data API requests per property. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function collectRealtime(
  userId: string,
  token: string,
  properties: Property[],
): Promise<RealtimePayload> {
  const now = Date.now();
  const live = new Set(properties.map((p) => keyFor(userId, p.id)));

  const due = properties.filter((p) => scheduler.isDue(keyFor(userId, p.id), now));

  await pool(due, 5, async (property) => {
    const key = keyFor(userId, property.id);
    const result = await fetchPropertyRealtime(token, property);

    scheduler.record(
      key,
      {
        activeUsers: result.summary.activeUsers,
        error: result.summary.error,
        quota: result.quota,
      },
      now,
    );

    // A failed refresh keeps the previous good snapshot visible rather than
    // blanking the map; the error still surfaces on that property's card.
    const previous = snapshots.get(key);
    if (result.summary.error && previous) {
      snapshots.set(key, {
        summary: { ...previous.summary, error: result.summary.error },
        points: previous.points,
        fetchedAt: previous.fetchedAt,
      });
    } else {
      snapshots.set(key, { summary: result.summary, points: result.points, fetchedAt: now });
    }
  });

  const summaries: RealtimeProperty[] = [];
  const points: MapPoint[] = [];

  for (const property of properties) {
    const snapshot = snapshots.get(keyFor(userId, property.id));
    if (!snapshot) {
      summaries.push({ propertyId: property.id, activeUsers: 0, pulse: new Array(30).fill(0) });
      continue;
    }
    summaries.push(snapshot.summary);
    points.push(...snapshot.points);
  }

  // Forget properties this user can no longer see.
  scheduler.retain(live);
  for (const key of snapshots.keys()) {
    if (key.startsWith(userId + ":") && !live.has(key)) snapshots.delete(key);
  }

  return {
    updatedAt: new Date().toISOString(),
    totalActiveUsers: summaries.reduce((sum, s) => sum + s.activeUsers, 0),
    properties: summaries,
    points,
  };
}

/** Drop everything for a user - used on disconnect and account deletion. */
export function forgetUser(userId: string): void {
  const prefix = userId + ":";
  for (const key of snapshots.keys()) if (key.startsWith(prefix)) snapshots.delete(key);
}

/** Diagnostics for the /healthz payload. */
export const trackedProperties = () => snapshots.size;
