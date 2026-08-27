import { config as loadEnv, parse as parseEnv } from "dotenv";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ (dev) or dist/ (build) -> server/ -> repo root
export const REPO_ROOT = path.resolve(here, "..", "..");

/** Overridable so tests and alternate deployments never touch the real file. */
const ENV_FILE = process.env.ENV_FILE
  ? path.resolve(process.env.ENV_FILE)
  : path.join(REPO_ROOT, ".env");

// Root .env wins; a server/.env is honoured as a fallback.
loadEnv({ path: ENV_FILE });
loadEnv({ path: path.join(REPO_ROOT, "server", ".env") });

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const port = num(process.env.PORT, 5175);

export const env = {
  clientId: (process.env.GOOGLE_CLIENT_ID ?? "").trim(),
  clientSecret: (process.env.GOOGLE_CLIENT_SECRET ?? "").trim(),
  // Follows PORT, so changing the port does not silently break the OAuth
  // callback the way a hardcoded default would.
  redirectUri:
    process.env.OAUTH_REDIRECT_URI ?? "http://localhost:" + port + "/api/auth/callback",
  port,
  /** Blank in production: the API and the built UI share one origin. */
  webOrigin: process.env.WEB_ORIGIN ?? "",
  realtimeTtl: num(process.env.REALTIME_TTL, 15) * 1000,
  statsTtl: num(process.env.STATS_TTL, 300) * 1000,
  mock: process.env.MOCK === "1" || process.env.MOCK === "true",
  /** Loopback by default: the setup endpoint accepts credentials, so it must
      not be reachable from the network unless you opt in. */
  host: process.env.HOST ?? "127.0.0.1",
  /** The in-app setup panel writes .env. It is a local convenience and must
      never be reachable on a deployed instance. */
  allowSetupUi: process.env.ALLOW_SETUP_UI !== "0" && process.env.NODE_ENV !== "production",
  /** How long a signed-in browser session lasts. */
  sessionTtl: num(process.env.SESSION_TTL_DAYS, 30) * 24 * 60 * 60 * 1000,
  /** Set behind HTTPS so the session cookie is never sent in the clear. */
  secureCookies: process.env.SECURE_COOKIES === "1" || process.env.NODE_ENV === "production",
  dataDir: path.join(REPO_ROOT, "data"),
  webDist: path.join(REPO_ROOT, "web", "dist"),
  /** Public marketing / legal pages. Must stay reachable without a session:
      Google's OAuth reviewer opens them in a signed-out browser. */
  siteDir: path.join(REPO_ROOT, "site"),
  envFile: ENV_FILE,
};

/**
 * A Google client ID is `<project-number>-<random>.apps.googleusercontent.com`,
 * so the client itself tells us which Cloud project must be configured. Showing
 * it removes the commonest setup failure: editing the wrong project.
 */
export function projectNumber(): string | null {
  const prefix = env.clientId.split("-")[0];
  return /^[0-9]{6,}$/.test(prefix) ? prefix : null;
}

/** A function, not a constant: credentials can change at runtime. */
export const isOAuthConfigured = () => Boolean(env.clientId && env.clientSecret);

/**
 * Re-read the OAuth client from the env file. Editing .env by hand should take
 * effect on save - needing a restart, with no feedback that one was needed, is
 * exactly the trap that wastes an afternoon.
 *
 * Returns true when the credentials actually changed.
 */
export function reloadOAuthFromFile(): boolean {
  let parsed: Record<string, string>;
  try {
    parsed = parseEnv(fs.readFileSync(env.envFile, "utf8"));
  } catch {
    return false; // file removed or unreadable - keep what we have
  }

  const clientId = (parsed.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (parsed.GOOGLE_CLIENT_SECRET ?? "").trim();
  if (clientId === env.clientId && clientSecret === env.clientSecret) return false;

  env.clientId = clientId;
  env.clientSecret = clientSecret;
  return true;
}
