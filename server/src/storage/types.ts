/**
 * The persistence contract.
 *
 * Everything is async even though the SQLite adapter is synchronous underneath,
 * so a Postgres adapter drops in behind this interface without touching a single
 * caller. Nothing above this file knows which database is in use.
 */

export type User = {
  id: string;
  googleSub: string;
  email: string;
  name: string | null;
  createdAt: number;
};

export type GoogleTokens = {
  refreshToken: string;
  accessToken: string | null;
  /** Epoch millis. */
  expiryDate: number | null;
  scope: string | null;
};

export type Session = {
  id: string;
  userId: string;
  expiresAt: number;
};

/**
 * Everything held about one person, for a GDPR subject access / portability
 * request. Deliberately excludes live credentials: the refresh token and
 * session ids are secrets, and writing them into a file the user downloads and
 * emails around would be a security hole, not a right. Their existence and
 * metadata are disclosed instead.
 */
export type UserExport = {
  generatedAt: string;
  account: { id: string; email: string; name: string | null; createdAt: string };
  googleConnection: {
    connected: boolean;
    scopesGranted: string[];
    tokenStoredAt: string | null;
  };
  propertyColours: { propertyId: string; colourSlot: number }[];
  sessions: { createdAt: string; expiresAt: string }[];
  notIncluded: string[];
};

export interface Storage {
  init(): Promise<void>;
  close(): Promise<void>;

  /** Google's `sub` is the stable identity; email can change. */
  upsertUser(googleSub: string, email: string, name: string | null): Promise<User>;
  getUser(id: string): Promise<User | null>;

  /** Refresh tokens are credentials - adapters must store them encrypted. */
  saveTokens(userId: string, tokens: GoogleTokens): Promise<void>;
  getTokens(userId: string): Promise<GoogleTokens | null>;
  deleteTokens(userId: string): Promise<void>;

  createSession(userId: string, ttlMs: number): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  deleteSession(id: string): Promise<void>;
  deleteExpiredSessions(): Promise<number>;

  /**
   * Stable colour/shape slots, per user. Returns a slot for every id given,
   * allocating new ones in the order supplied.
   */
  slotsFor(userId: string, propertyIds: string[]): Promise<Map<string, number>>;

  /** Everything held about this user, for a subject access request. */
  exportUser(userId: string): Promise<UserExport | null>;

  /** Full erasure - required by Google's user data policy. */
  deleteUser(userId: string): Promise<void>;
}
