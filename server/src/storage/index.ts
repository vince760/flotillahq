import { PostgresStorage } from "./postgres.js";
import { SqliteStorage } from "./sqlite.js";
import type { Storage } from "./types.js";

export type { GoogleTokens, Session, Storage, User, UserExport } from "./types.js";

/**
 * The one place that decides which adapter is in use.
 *
 * DATABASE_URL wins when present, so production can share an existing Postgres
 * server while local development stays on a zero-setup SQLite file.
 */
export function createStorage(): Storage {
  if (process.env.DATABASE_URL) return new PostgresStorage();
  return new SqliteStorage();
}

let instance: Storage | null = null;

export async function getStorage(): Promise<Storage> {
  if (!instance) {
    instance = createStorage();
    await instance.init();
  }
  return instance;
}

/** Which adapter is active — reported at startup so it is never a guess. */
export const storageKind = () => (process.env.DATABASE_URL ? "postgres" : "sqlite");
