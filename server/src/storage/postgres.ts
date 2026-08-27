import { Pool } from "pg";
import { decrypt, encrypt, token } from "../crypto.js";
import type { GoogleTokens, Session, Storage, User, UserExport } from "./types.js";

/**
 * Postgres adapter, for sharing an existing database server rather than paying
 * for a second one.
 *
 * The intended deployment is a dedicated database owned by a dedicated role, so
 * the default schema is `public`.
 *
 * DATABASE_SCHEMA exists for the other case: sharing a database with another
 * application. This app owns tables called `users` and `sessions`, which would
 * collide with almost anything else, and a named schema separates them without
 * needing CREATE DATABASE rights — which managed hosts often withhold.
 */
export class PostgresStorage implements Storage {
  private pool!: Pool;

  private readonly schema: string;

  constructor(
    private readonly connectionString = process.env.DATABASE_URL ?? "",
    schema = process.env.DATABASE_SCHEMA ?? "public",
  ) {
    // Validated in the body, not as a default parameter value: a default only
    // runs when the argument is omitted, so putting it there would let any
    // explicit caller slip an unchecked identifier into CREATE SCHEMA.
    this.schema = sanitiseSchema(schema);
  }

  async init(): Promise<void> {
    if (!this.connectionString) throw new Error("DATABASE_URL is not set.");

    this.pool = new Pool({
      connectionString: this.connectionString,
      // Shared instances have a modest connection cap, and this app is
      // read-heavy with tiny queries — a big pool would starve the neighbours.
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: needsSsl(this.connectionString) ? { rejectUnauthorized: false } : undefined,
      // search_path is set as a connection startup parameter, applied by the
      // server before the connection is usable. Doing it in an on("connect")
      // handler instead would race: that handler is not awaited, so the first
      // real query can reach the wrong schema. The name is validated as a plain
      // identifier in the constructor, so it is safe to interpolate here.
      options: `-c search_path=${this.schema}`,
    });

    this.pool.on("error", (err) => {
      console.error("[flotilla] idle postgres client error", err);
    });

    // The schema has to exist before any pooled connection resolves it, and a
    // connection whose search_path names a missing schema still works for this.
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);

    // BIGINT for epoch millis: Postgres INTEGER overflows in 2038. pg returns
    // BIGINT as a string, so every read goes through Number().
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        google_sub  TEXT NOT NULL UNIQUE,
        email       TEXT NOT NULL,
        name        TEXT,
        created_at  BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS google_tokens (
        user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        refresh_token TEXT NOT NULL,
        access_token  TEXT,
        expiry_date   BIGINT,
        scope         TEXT,
        updated_at    BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL
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

  async close(): Promise<void> {
    await this.pool?.end();
  }

  // -- users -----------------------------------------------------------------

  async upsertUser(googleSub: string, email: string, name: string | null): Promise<User> {
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, google_sub, email, name, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
       RETURNING *`,
      [token(16), googleSub, email, name, Date.now()],
    );
    return toUser(rows[0]);
  }

  async getUser(id: string): Promise<User | null> {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  // -- tokens ----------------------------------------------------------------

  async saveTokens(userId: string, tokens: GoogleTokens): Promise<void> {
    await this.pool.query(
      `INSERT INTO google_tokens (user_id, refresh_token, access_token, expiry_date, scope, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         refresh_token = EXCLUDED.refresh_token,
         access_token  = EXCLUDED.access_token,
         expiry_date   = EXCLUDED.expiry_date,
         scope         = EXCLUDED.scope,
         updated_at    = EXCLUDED.updated_at`,
      [
        userId,
        encrypt(tokens.refreshToken),
        tokens.accessToken ? encrypt(tokens.accessToken) : null,
        tokens.expiryDate,
        tokens.scope,
        Date.now(),
      ],
    );
  }

  async getTokens(userId: string): Promise<GoogleTokens | null> {
    const { rows } = await this.pool.query("SELECT * FROM google_tokens WHERE user_id = $1", [
      userId,
    ]);
    const row = rows[0];
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
    await this.pool.query("DELETE FROM google_tokens WHERE user_id = $1", [userId]);
  }

  // -- sessions --------------------------------------------------------------

  async createSession(userId: string, ttlMs: number): Promise<Session> {
    const session: Session = { id: token(32), userId, expiresAt: Date.now() + ttlMs };
    await this.pool.query(
      "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
      [session.id, session.userId, session.expiresAt, Date.now()],
    );
    return session;
  }

  async getSession(id: string): Promise<Session | null> {
    const { rows } = await this.pool.query("SELECT * FROM sessions WHERE id = $1", [id]);
    const row = rows[0];
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
    await this.pool.query("DELETE FROM sessions WHERE id = $1", [id]);
  }

  async deleteExpiredSessions(): Promise<number> {
    const result = await this.pool.query("DELETE FROM sessions WHERE expires_at <= $1", [
      Date.now(),
    ]);
    return result.rowCount ?? 0;
  }

  // -- colour slots ----------------------------------------------------------

  async slotsFor(userId: string, propertyIds: string[]): Promise<Map<string, number>> {
    const slots = new Map<string, number>();
    if (propertyIds.length === 0) return slots;

    const { rows } = await this.pool.query(
      "SELECT property_id, slot FROM property_slots WHERE user_id = $1",
      [userId],
    );
    for (const row of rows) slots.set(String(row.property_id), Number(row.slot));

    const missing = propertyIds.filter((id) => !slots.has(id));
    if (missing.length === 0) return slots;

    // Continue from the highest slot already handed out, so existing properties
    // never change colour when a new one appears.
    let next = rows.reduce((max: number, row) => Math.max(max, Number(row.slot) + 1), 0);
    for (const id of missing) {
      await this.pool.query(
        `INSERT INTO property_slots (user_id, property_id, slot) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, property_id) DO NOTHING`,
        [userId, id, next],
      );
      slots.set(id, next);
      next += 1;
    }
    return slots;
  }

  // -- export / erasure ------------------------------------------------------

  async exportUser(userId: string): Promise<UserExport | null> {
    const user = await this.getUser(userId);
    if (!user) return null;

    const [tokens, slots, sessions] = await Promise.all([
      this.pool.query("SELECT scope, updated_at FROM google_tokens WHERE user_id = $1", [userId]),
      this.pool.query(
        "SELECT property_id, slot FROM property_slots WHERE user_id = $1 ORDER BY slot",
        [userId],
      ),
      this.pool.query(
        "SELECT created_at, expires_at FROM sessions WHERE user_id = $1 ORDER BY created_at",
        [userId],
      ),
    ]);

    const tokenRow = tokens.rows[0];
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
        scopesGranted: String(tokenRow?.scope ?? "")
          .split(" ")
          .filter(Boolean),
        tokenStoredAt: tokenRow ? iso(tokenRow.updated_at) : null,
      },
      propertyColours: slots.rows.map((row) => ({
        propertyId: String(row.property_id),
        colourSlot: Number(row.slot),
      })),
      sessions: sessions.rows.map((row) => ({
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
    await this.pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
}

function toUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    googleSub: String(row.google_sub),
    email: String(row.email),
    name: row.name == null ? null : String(row.name),
    createdAt: Number(row.created_at),
  };
}

/** Schema names are interpolated, not parameterised — allow a safe subset only. */
function sanitiseSchema(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      "DATABASE_SCHEMA must be a plain identifier (letters, digits, underscore): " + name,
    );
  }
  return name;
}

/** Managed Postgres requires TLS; a local instance generally does not. */
function needsSsl(url: string): boolean {
  if (process.env.DATABASE_SSL === "0") return false;
  if (process.env.DATABASE_SSL === "1") return true;
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}
