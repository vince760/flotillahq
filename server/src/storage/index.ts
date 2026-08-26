import { SqliteStorage } from "./sqlite.js";
import type { Storage } from "./types.js";

export type { GoogleTokens, Session, Storage, User } from "./types.js";

/**
 * The one place that decides which adapter is in use. Adding Postgres means
 * adding a branch here and a file next to sqlite.ts — nothing else changes.
 */
export function createStorage(): Storage {
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
