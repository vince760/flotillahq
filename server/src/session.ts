import type { NextFunction, Request, Response } from "express";
import { env } from "./env.js";
import { getStorage } from "./storage/index.js";
import type { User } from "./storage/types.js";

const SESSION_COOKIE = "at_session";
const STATE_COOKIE = "at_oauth_state";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
    }
  }
}

/** Minimal cookie parsing — one header, no dependency. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function setCookie(res: Response, name: string, value: string, maxAgeMs: number): void {
  const parts = [
    name + "=" + encodeURIComponent(value),
    "Path=/",
    "HttpOnly",
    // Lax still travels on the top-level GET redirect back from Google, while
    // blocking the cross-site POSTs that Strict is there to stop.
    "SameSite=Lax",
    "Max-Age=" + Math.floor(maxAgeMs / 1000),
  ];
  if (env.secureCookies) parts.push("Secure");
  appendCookie(res, parts.join("; "));
}

function clearCookie(res: Response, name: string): void {
  const parts = [name + "=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (env.secureCookies) parts.push("Secure");
  appendCookie(res, parts.join("; "));
}

function appendCookie(res: Response, cookie: string): void {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) res.setHeader("Set-Cookie", [cookie]);
  else if (Array.isArray(existing)) res.setHeader("Set-Cookie", [...existing, cookie]);
  else res.setHeader("Set-Cookie", [String(existing), cookie]);
}

// -- session -----------------------------------------------------------------

export async function startSession(res: Response, userId: string): Promise<void> {
  const storage = await getStorage();
  const session = await storage.createSession(userId, env.sessionTtl);
  setCookie(res, SESSION_COOKIE, session.id, env.sessionTtl);
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const id = readCookie(req, SESSION_COOKIE);
  if (id) {
    const storage = await getStorage();
    await storage.deleteSession(id);
  }
  clearCookie(res, SESSION_COOKIE);
}

/**
 * Resolves the session on every request. Never rejects — routes that require a
 * user use `requireUser`, so public routes stay public.
 */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const id = readCookie(req, SESSION_COOKIE);
    if (id) {
      const storage = await getStorage();
      const session = await storage.getSession(id);
      if (session) {
        const user = await storage.getUser(session.userId);
        if (user) {
          req.user = user;
          req.sessionId = session.id;
        }
      }
    }
  } catch (err) {
    console.error("[flotilla] session lookup failed", err);
  }
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }
  next();
}

// -- OAuth state -------------------------------------------------------------

/** The nonce lives in its own short-lived cookie, so it survives a restart and
    works across multiple server instances without shared memory. */
export function setOAuthState(res: Response, state: string): void {
  setCookie(res, STATE_COOKIE, state, 10 * 60 * 1000);
}

export function takeOAuthState(req: Request, res: Response): string | null {
  const state = readCookie(req, STATE_COOKIE);
  clearCookie(res, STATE_COOKIE);
  return state;
}

/**
 * MOCK only: give the visitor a local demo account automatically, so
 * `npm run dev:mock` still needs no Google setup at all now that every data
 * route requires a session. Never mounted unless MOCK is on.
 */
export async function ensureDemoUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.user) return next();
  try {
    const storage = await getStorage();
    const user = await storage.upsertUser("mock-demo-user", "demo@localhost", "Demo");
    await startSession(res, user.id);
    req.user = user;
  } catch (err) {
    console.error("[flotilla] could not start the demo session", err);
  }
  next();
}
