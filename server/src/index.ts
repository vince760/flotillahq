import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { env, isOAuthConfigured, projectNumber, reloadOAuthFromFile } from "./env.js";
import {
  accessTokenFor,
  authUrl,
  completeSignIn,
  configureOAuth,
  disconnect,
  isConnected,
  HttpError,
} from "./auth.js";
import { cache } from "./cache.js";
import { fetchStats, listProperties } from "./gaClient.js";
import { collectRealtime, forgetUser } from "./realtime.js";
import { mockProperties, mockRealtime, mockStats } from "./mock.js";
import { RANGES, isRangeKey, type RangeKey } from "./ranges.js";
import {
  attachUser,
  endSession,
  ensureDemoUser,
  requireUser,
  setOAuthState,
  startSession,
  takeOAuthState,
} from "./session.js";
import { getStorage, storageKind } from "./storage/index.js";
import { rateLimit, securityHeaders } from "./hardening.js";
import type { Property, PropertySummary, StatsPayload } from "./types.js";

const app = express();
app.disable("x-powered-by");
// Behind a reverse proxy (Render, Fly, Caddy) req.protocol and req.ip are only
// correct with this set - secure cookies and the rate limiter both depend on it.
if (process.env.TRUST_PROXY !== "0") app.set("trust proxy", 1);
app.use(securityHeaders);
app.use(express.json({ limit: "16kb" }));

// Sign-in is the expensive, abusable path; keep it tighter than the rest.
app.use("/api/auth", rateLimit({ windowMs: 15 * 60_000, max: 30, name: "auth" }));
app.use("/api", rateLimit({ windowMs: 60_000, max: 240, name: "api" }));

app.use(attachUser);
// Dev convenience only: MOCK hands visitors a local demo account so the demo
// path needs no Google credentials.
if (env.mock) app.use(ensureDemoUser);

/** Forward async rejections into the Express error handler. */
const route =
  (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch(next);

const isLoopback = (req: Request) => {
  const ip = req.socket.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
};

const PROPERTIES_TTL = 10 * 60 * 1000;

/** MOCK is a development convenience; a connected account always wins. */
const useMock = async (userId: string) => env.mock && !(await isConnected(userId));

/**
 * Every cache key is namespaced by user. This is load-bearing: a shared key
 * would serve one customer's analytics to another.
 */
const key = (userId: string, name: string) => userId + ":" + name;

/** Hold a failed result only briefly, so fixing the cause takes effect at once. */
const FAILURE_TTL = 10_000;
const ttlFor = <T extends { error?: string }>(full: number) => (rows: T[]) =>
  rows.some((r) => r.error) ? FAILURE_TTL : full;

async function propertiesFor(userId: string): Promise<Property[]> {
  const storage = await getStorage();

  const summaries: PropertySummary[] = (await useMock(userId))
    ? mockProperties()
    : await cache.wrap(key(userId, "properties"), PROPERTIES_TTL, async () =>
        listProperties(await accessTokenFor(userId)),
      );

  // Colour slots are per user, so two people never fight over the same palette.
  const slots = await storage.slotsFor(
    userId,
    summaries.map((p) => p.id),
  );
  return summaries
    .map((p) => ({ ...p, slot: slots.get(p.id) ?? 0 }))
    .sort((a, b) => a.slot - b.slot);
}

/** Liveness probe for the platform. No auth, no database work on the hot path. */
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

// -- Session -----------------------------------------------------------------

app.get(
  "/api/status",
  route(async (req, res) => {
    const user = req.user;
    const connected = user ? await isConnected(user.id) : false;

    res.json({
      signedIn: Boolean(user),
      connected,
      mock: user ? await useMock(user.id) : false,
      oauthConfigured: isOAuthConfigured(),
      setupUiAvailable: env.allowSetupUi,
      redirectUri: env.redirectUri,
      projectNumber: projectNumber(),
      email: user?.email ?? null,
      name: user?.name ?? null,
      ranges: Object.entries(RANGES).map(([k, spec]) => ({ key: k, label: spec.label })),
    });
  }),
);

app.get("/api/auth/login", (_req, res) => {
  if (!isOAuthConfigured()) {
    res.status(500).send("This instance has no Google OAuth client configured.");
    return;
  }
  const { url, state } = authUrl();
  setOAuthState(res, state);
  res.redirect(url);
});

app.get(
  "/api/auth/callback",
  route(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const failure = typeof req.query.error === "string" ? req.query.error : "";
    const expected = takeOAuthState(req, res);
    const home = env.webOrigin || "/";

    if (failure) {
      res.redirect(home + "?auth=" + encodeURIComponent(failure));
      return;
    }
    // Reject anything we did not initiate, before the code is exchanged.
    if (!code || !state || !expected || state !== expected) {
      res.redirect(home + "?auth=bad_state");
      return;
    }

    const { user, missingScope } = await completeSignIn(code);
    await startSession(res, user.id);
    res.redirect(home + (missingScope ? "?auth=missing_scope" : "?auth=ok"));
  }),
);

app.post("/api/auth/configure", (req, res) => {
  // The setup panel writes to the server's filesystem - local development only.
  if (!env.allowSetupUi || !isLoopback(req)) {
    res.status(403).json({
      error:
        "The setup panel is disabled on this instance. Set GOOGLE_CLIENT_ID and " +
        "GOOGLE_CLIENT_SECRET in the environment instead.",
    });
    return;
  }

  const { clientId, clientSecret } = (req.body ?? {}) as Record<string, unknown>;
  const result = configureOAuth(
    typeof clientId === "string" ? clientId.trim() : "",
    typeof clientSecret === "string" ? clientSecret.trim() : "",
  );
  if (!result.ok) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.json({ ok: true });
});

app.post(
  "/api/auth/logout",
  route(async (req, res) => {
    await endSession(req, res);
    res.json({ ok: true });
  }),
);

/** Revoke Google access but keep the account. */
app.post(
  "/api/auth/disconnect",
  requireUser,
  route(async (req, res) => {
    await disconnect(req.user!.id);
    cache.clearPrefix(req.user!.id + ":");
    forgetUser(req.user!.id);
    res.json({ ok: true });
  }),
);

/** Subject access / portability: everything held about the caller. */
app.get(
  "/api/account/export",
  requireUser,
  route(async (req, res) => {
    const storage = await getStorage();
    const data = await storage.exportUser(req.user!.id);
    if (!data) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    const stamp = data.generatedAt.slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="flotilla-export-' + stamp + '.json"',
    );
    res.send(JSON.stringify(data, null, 2));
  }),
);

/** Full erasure - required by Google's user data policy. */
app.post(
  "/api/account/delete",
  requireUser,
  route(async (req, res) => {
    const userId = req.user!.id;
    await disconnect(userId);
    const storage = await getStorage();
    await storage.deleteUser(userId);
    cache.clearPrefix(userId + ":");
    forgetUser(userId);
    await endSession(req, res);
    res.json({ ok: true });
  }),
);

// -- Data --------------------------------------------------------------------

app.get(
  "/api/properties",
  requireUser,
  route(async (req, res) => {
    res.json({ properties: await propertiesFor(req.user!.id) });
  }),
);

app.get(
  "/api/realtime",
  requireUser,
  route(async (req, res) => {
    const userId = req.user!.id;
    const list = await propertiesFor(userId);

    const payload = (await useMock(userId))
      ? mockRealtime(list)
      : // Short TTL only to collapse concurrent tabs; per-property refresh rate
        // is decided by the scheduler inside collectRealtime.
        await cache.wrap(key(userId, "realtime"), 3_000, async () =>
          collectRealtime(userId, await accessTokenFor(userId), list),
        );
    res.json(payload);
  }),
);

app.get(
  "/api/stats",
  requireUser,
  route(async (req, res) => {
    const userId = req.user!.id;
    const range: RangeKey = isRangeKey(req.query.range) ? req.query.range : "7d";
    const list = await propertiesFor(userId);
    const spec = RANGES[range];

    const stats = (await useMock(userId))
      ? mockStats(list, range)
      : await cache.wrap(
          key(userId, "stats:" + range),
          env.statsTtl,
          async () => fetchStats(await accessTokenFor(userId), list, range),
          ttlFor(env.statsTtl),
        );

    const payload: StatsPayload = {
      range,
      rangeLabel: spec.label,
      seriesDimension: spec.seriesDimension,
      updatedAt: new Date().toISOString(),
      properties: stats,
    };
    res.json(payload);
  }),
);

// -- Public pages ------------------------------------------------------------

/**
 * Homepage, privacy policy and terms. These are a hard requirement for Google
 * OAuth verification and are deliberately served with no session check - the
 * reviewer visits them signed out, and a login wall fails the review.
 */
if (fs.existsSync(env.siteDir)) {
  // index:false so this never shadows the dashboard at /.
  app.use(express.static(env.siteDir, { index: false, extensions: ["html"] }));

  const page = (file: string) => (_req: Request, res: Response) =>
    res.sendFile(path.join(env.siteDir, file));

  app.get("/about", page("index.html"));
  app.get("/privacy", page("privacy.html"));
  app.get("/terms", page("terms.html"));
}

// -- Static UI (production build) --------------------------------------------

if (fs.existsSync(env.webDist)) {
  app.use(express.static(env.webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(env.webDist, "index.html"));
  });
}

// -- Errors ------------------------------------------------------------------

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Unexpected server error";
  if (status >= 500) console.error("[flotilla]", err);
  res.status(status).json({ error: message });
});

// -- Startup -----------------------------------------------------------------

const server = app.listen(env.port, env.host, async () => {
  console.log("[flotilla] listening on http://localhost:" + env.port + " (storage: " + storageKind() + ")");

  // Without this catch a failed database connection becomes an unhandled
  // rejection, which kills the process: the platform then restart-loops while
  // showing a stack trace instead of the actual problem.
  try {
    const storage = await getStorage();
    const purged = await storage.deleteExpiredSessions();
    if (purged > 0) console.log("[flotilla] cleared " + purged + " expired sessions");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[flotilla] Could not reach the database: " + detail);
    if (process.env.DATABASE_URL) {
      console.error(
        "[flotilla] If this says SSL/TLS required, set DATABASE_SSL=1. Managed " +
          "Postgres requires TLS on internal and external URLs alike; only a " +
          "local database should use 0.",
      );
    }
    process.exit(1);
  }

  if (!isOAuthConfigured()) {
    console.log("[flotilla] No OAuth client yet - click Connect in the UI to set one up.");
  }
  if (env.mock) {
    console.log("[flotilla] MOCK enabled - users without a Google connection see demo data.");
  }
});

/**
 * Pick up hand-edited credentials on save. fs.watch fires "rename" as well as
 * "change" because many editors write via a temp file and swap it in, and it
 * can fire several times for one save - hence the debounce.
 */
try {
  let pending: NodeJS.Timeout | null = null;
  fs.watch(env.envFile, () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      if (reloadOAuthFromFile()) {
        console.log(
          isOAuthConfigured()
            ? "[flotilla] Picked up a new Google OAuth client from " + env.envFile
            : "[flotilla] Google OAuth credentials were cleared in " + env.envFile,
        );
      }
    }, 250);
  }).unref();
} catch {
  // No env file to watch (credentials come from the environment) - fine.
}

// Expired sessions accumulate; sweep hourly rather than only at boot.
const sweep = setInterval(
  () => {
    void getStorage().then((s) => s.deleteExpiredSessions());
  },
  60 * 60 * 1000,
);
sweep.unref();

/**
 * Deploys send SIGTERM. Draining first avoids dropped requests, and closing
 * SQLite cleanly checkpoints the WAL instead of leaving it for recovery.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[flotilla] " + signal + " received, draining...");

  const forced = setTimeout(() => {
    console.error("[flotilla] drain timed out, exiting anyway");
    process.exit(1);
  }, 10_000);
  forced.unref();

  server.close(async () => {
    try {
      const storage = await getStorage();
      await storage.close();
    } catch (err) {
      console.error("[flotilla] error closing storage", err);
    }
    console.log("[flotilla] shutdown complete");
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      "[flotilla] Port " +
        env.port +
        " is already in use - an older copy of this server is probably still running.",
    );
    process.exit(1);
  }
  throw err;
});
