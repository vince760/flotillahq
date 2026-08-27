import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env.js";
import { decrypt, encrypt, token } from "../crypto.js";
import type { GoogleTokens, Session, Storage, User, UserExport } from "./types.js";

/**
 * SQLite adapter, on Node's built-in driver - no native module to compile.
 * Comfortably handles thousands of users on one box; swap the adapter for
 * Postgres when a single writer stops being enough.
 */
export class SqliteStorage implements Storage {
  private db!: DatabaseSync;

  constructor(private readonly file = path.join(env.dataDir, "flotilla.db")) {}

  async init(): Promise<void> {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.adoptLegacyDatabase();
    this.db = new DatabaseSync(this.file);

    // WAL lets reads proceed during writes; FULL sync would halve write speed
    // for durability we do not need on a cache-heavy dashboard.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        google_sub  TEXT NOT NULL UNIQUE,
        email       TEXT NOT NULL,
        name        TEXT,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS google_tokens (
        user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        refresh_token TEXT NOT NULL,
        access_token  TEXT,
        expiry_date   INTEGER,
        scope         TEXT,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS property_slots (
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL,
        slot        INTEGER NOT NULL,
        PRIMARY KEY (user_id, property_id)
      );
    `);
  }

  /**
   * The database file was named after the product, and the product was renamed
   * from "Analytic Tracker" to "Flotilla". Move the old file across rather than
   * silently starting empty, which would look to every existing user like their
   * Google connection had vanished.
   *
   * The -wal and -shm siblings move too; leaving them behind would strand
   * committed transactions that had not yet been checkpointed.
   */
  private adoptLegacyDatabase(): void {
    if (fs.existsSync(this.file)) return;

    const legacy = path.join(path.dirname(this.file), "analytic-tracker.db");
    if (!fs.existsSync(legacy)) return;

    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        if (fs.existsSync(legacy + suffix)) fs.renameSync(legacy + suffix, this.file + suffix);
      } catch (err) {
        console.error("[flotilla] could not migrate " + legacy + suffix, err);
      }
    }
    console.log("[flotilla] migrated the database from analytic-tracker.db");
  }

  async close(): Promise<void> {
    this.db?.close();
  }

  // -- users -----------------------------------------------------------------

  async upsertUser(googleSub: string, email: string, name: string | null): Promise<User> {
    const existing = this.db
      .prepare("SELECT * FROM users WHERE google_sub = ?")
      .get(googleSub) as Record<string, unknown> | undefined;

    if (existing) {
      // Email and name can change on Google's side; sub never does.
      this.db
        .prepare("UPDATE users SET email = ?, name = ? WHERE google_sub = ?")
        .run(email, name, googleSub);
      return this.rowToUser({ ...existing, email, name });
    }

    const user: User = {
      id: token(16),
      googleSub,
      email,
      name,
      createdAt: Date.now(),
    };
    this.db
      .prepare("INSERT INTO users (id, google_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, user.googleSub, user.email, user.name, user.createdAt);
    return user;
  }

  async getUser(id: string): Promise<User | null> {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToUser(row) : null;
  }

  private rowToUser(row: Record<string, unknown>): User {
    return {
      id: String(row.id),
      googleSub: String(row.google_sub),
      email: String(row.email),
      name: row.name == null ? null : String(row.name),
      createdAt: Number(row.created_at),
    };
  }

  // -- tokens ----------------------------------------------------------------

  async saveTokens(userId: string, tokens: GoogleTokens): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO google_tokens (user_id, refresh_token, access_token, expiry_date, scope, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           refresh_token = excluded.refresh_token,
           access_token  = excluded.access_token,
           expiry_date   = excluded.expiry_date,
           scope         = excluded.scope,
           updated_at    = excluded.updated_at`,
      )
      .run(
        userId,
        encrypt(tokens.refreshToken),
        tokens.accessToken ? encrypt(tokens.accessToken) : null,
        tokens.expiryDate,
        tokens.scope,
        Date.now(),
      );
  }

  async getTokens(userId: string): Promise<GoogleTokens | null> {
    const row = this.db.prepare("SELECT * FROM google_tokens WHERE user_id = ?").get(userId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;

    try {
      return {
        refreshToken: decrypt(String(row.refresh_token)),
        accessToken: row.access_token == null ? null : decrypt(String(row.access_token)),
        expiryDate: row.expiry_date == null ? null : Number(row.expiry_date),
        scope: row.scope == null ? null : String(row.scope),
      };
    } catch {
      // Wrong or rotated ENCRYPTION_KEY: treat as "not connected" so the user
      // can simply reconnect, rather than crashing every request.
      console.error("[flotilla] Could not decrypt tokens for user " + userId);
      return null;
    }
  }

  async deleteTokens(userId: string): Promise<void> {
    this.db.prepare("DELETE FROM google_tokens WHERE user_id = ?").run(userId);
  }

  // -- sessions --------------------------------------------------------------

  async createSession(userId: string, ttlMs: number): Promise<Session> {
    const session: Session = { id: token(32), userId, expiresAt: Date.now() + ttlMs };
    this.db
      .prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(session.id, session.userId, session.expiresAt, Date.now());
    return session;
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;

    const session: Session = {
      id: String(row.id),
      userId: String(row.user_id),
      expiresAt: Number(row.expires_at),
    };
    if (session.expiresAt <= Date.now()) {
      await this.deleteSession(session.id);
      return null;
    }
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  async deleteExpiredSessions(): Promise<number> {
    const result = this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    return Number(result.changes ?? 0);
  }

  // -- colour slots ----------------------------------------------------------

  async slotsFor(userId: string, propertyIds: string[]): Promise<Map<string, number>> {
    const slots = new Map<string, number>();
    if (propertyIds.length === 0) return slots;

    const rows = this.db
      .prepare("SELECT property_id, slot FROM property_slots WHERE user_id = ?")
      .all(userId) as Record<string, unknown>[];
    for (const row of rows) slots.set(String(row.property_id), Number(row.slot));

    const missing = propertyIds.filter((id) => !slots.has(id));
    if (missing.length === 0) return slots;

    // Continue from the highest slot already handed out, so existing properties
    // never change colour when a new one appears.
    let next = rows.reduce((max, row) => Math.max(max, Number(row.slot) + 1), 0);
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO property_slots (user_id, property_id, slot) VALUES (?, ?, ?)",
    );
    for (const id of missing) {
      insert.run(userId, id, next);
      slots.set(id, next);
      next += 1;
    }
    return slots;
  }

  async exportUser(userId: string): Promise<UserExport | null> {
    const user = await this.getUser(userId);
    if (!user) return null;

    const tokenRow = this.db
      .prepare("SELECT scope, updated_at FROM google_tokens WHERE user_id = ?")
      .get(userId) as Record<string, unknown> | undefined;

    const slots = this.db
      .prepare("SELECT property_id, slot FROM property_slots WHERE user_id = ? ORDER BY slot")
      .all(userId) as Record<string, unknown>[];

    const sessions = this.db
      .prepare("SELECT created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at")
      .all(userId) as Record<string, unknown>[];

    const iso = (v: unknown) => new Date(Number(v)).toISOString();

    return {
      generatedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: iso(user.createdAt),
      },
      googleConnection: {
        connected: Boolean(tokenRow),
        scopesGranted: String(tokenRow?.scope ?? "").split(" ").filter(Boolean),
        tokenStoredAt: tokenRow ? iso(tokenRow.updated_at) : null,
      },
      propertyColours: slots.map((row) => ({
        propertyId: String(row.property_id),
        colourSlot: Number(row.slot),
      })),
      sessions: sessions.map((row) => ({
        createdAt: iso(row.created_at),
        expiresAt: iso(row.expires_at),
      })),
      notIncluded: [
        "Your Google Analytics reports. They are read from Google on demand and " +
          "never written to disk, so there is no stored copy to export.",
        "Your Google refresh and access tokens, and your session identifiers. " +
          "These are credentials rather than personal data; including them in a " +
          "downloadable file would put your Google account at risk.",
      ],
    };
  }

  async deleteUser(userId: string): Promise<void> {
    // ON DELETE CASCADE clears tokens, sessions and slots.
    this.db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }
}
