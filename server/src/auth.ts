import { OAuth2Client, type Credentials } from "google-auth-library";
import { env, isOAuthConfigured } from "./env.js";
import { token } from "./crypto.js";
import { getStorage } from "./storage/index.js";
import type { User } from "./storage/types.js";
import { persistCredentials, validateCredentials, type SetupResult } from "./setup.js";

export const ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export const SCOPES = [
  ANALYTICS_SCOPE,
  "openid",
  "email",
  "profile",
];

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A bare client, used for the code exchange and for building per-user clients. */
function newClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.redirectUri,
  });
}

/** Accept credentials from the local setup panel and apply them immediately. */
export function configureOAuth(clientId: string, clientSecret: string): SetupResult {
  const check = validateCredentials(clientId, clientSecret);
  if (!check.ok) return check;

  env.clientId = clientId;
  env.clientSecret = clientSecret;
  persistCredentials(clientId, clientSecret);
  return { ok: true };
}

export function authUrl(): { url: string; state: string } {
  const state = token(32);
  const url = newClient().generateAuthUrl({
    state,
    access_type: "offline",
    // Always ask, so Google always returns a refresh_token - without one a
    // returning user would be stuck re-authorising on every visit.
    prompt: "consent",
    scope: SCOPES,
    // No include_granted_scopes: we always ask for the full set, so incremental
    // authorisation buys nothing and is a known source of opaque failures.
  });
  return { url, state };
}

type UserInfo = { sub?: string; email?: string; name?: string };

/**
 * Exchange the authorisation code, identify the Google account, and store the
 * tokens against that user. Returns the user the caller should open a session
 * for.
 */
export type SignInResult = { user: User; missingScope: boolean };

export async function completeSignIn(code: string): Promise<SignInResult> {
  const client = newClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token) {
    throw new HttpError(502, "Google did not return an access token.");
  }

  const info = await fetchUserInfo(tokens.access_token);
  if (!info.sub || !info.email) {
    throw new HttpError(502, "Google did not return an account identity.");
  }

  const storage = await getStorage();
  const user = await storage.upsertUser(info.sub, info.email, info.name ?? null);

  // Google silently drops scopes that are not registered on the consent
  // screen, and a user can untick optional ones. Tokens without the Analytics
  // scope are useless here, so refuse them rather than storing a dud and
  // failing later with an opaque error on every data call.
  // OAuth scope strings are space-delimited by spec - no regex needed.
  const granted = (tokens.scope ?? "").split(" ").filter(Boolean);
  if (!granted.includes(ANALYTICS_SCOPE)) {
    return { user, missingScope: true };
  }

  if (tokens.refresh_token) {
    await storage.saveTokens(user.id, {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiryDate: tokens.expiry_date ?? null,
      scope: tokens.scope ?? null,
    });
  } else {
    // Google withholds refresh_token on a repeat grant; keep the existing one
    // and just refresh the access token.
    const existing = await storage.getTokens(user.id);
    if (!existing) {
      throw new HttpError(
        502,
        "Google did not return a refresh token. Remove this app at " +
          "myaccount.google.com/permissions and connect again.",
      );
    }
    await storage.saveTokens(user.id, {
      ...existing,
      accessToken: tokens.access_token,
      expiryDate: tokens.expiry_date ?? null,
    });
  }

  return { user, missingScope: false };
}

async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!res.ok) throw new HttpError(502, "Could not read the Google account profile.");
  return (await res.json()) as UserInfo;
}

/** Whether this user has usable Google credentials stored. */
export async function isConnected(userId: string): Promise<boolean> {
  const storage = await getStorage();
  return Boolean(await storage.getTokens(userId));
}

/**
 * A valid access token for one user, refreshing and re-persisting as needed.
 * This is the only path by which Analytics data is ever fetched.
 */
export async function accessTokenFor(userId: string): Promise<string> {
  if (!isOAuthConfigured()) {
    throw new HttpError(500, "This instance has no Google OAuth client configured.");
  }

  const storage = await getStorage();
  const stored = await storage.getTokens(userId);
  if (!stored) throw new HttpError(401, "Google Analytics is not connected for this account.");

  const client = newClient();
  client.setCredentials({
    refresh_token: stored.refreshToken,
    access_token: stored.accessToken ?? undefined,
    expiry_date: stored.expiryDate ?? undefined,
  });

  let fresh: Credentials;
  try {
    const result = await client.getAccessToken();
    if (!result.token) throw new Error("empty token");
    fresh = client.credentials;
    if (result.token !== stored.accessToken) {
      await storage.saveTokens(userId, {
        refreshToken: fresh.refresh_token ?? stored.refreshToken,
        accessToken: result.token,
        expiryDate: fresh.expiry_date ?? null,
        scope: fresh.scope ?? stored.scope,
      });
    }
    return result.token;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // invalid_grant means the user revoked access, or the 7-day testing-mode
    // expiry elapsed. Clear the dead token so the UI prompts a reconnect.
    if (message.includes("invalid_grant")) {
      await storage.deleteTokens(userId);
      throw new HttpError(401, "Google access expired or was revoked. Please reconnect.");
    }
    throw new HttpError(502, "Could not refresh Google access: " + message);
  }
}

/** Revoke at Google, then forget locally. Best effort on the remote call. */
export async function disconnect(userId: string): Promise<void> {
  const storage = await getStorage();
  const stored = await storage.getTokens(userId);

  if (stored?.refreshToken) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(stored.refreshToken), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch {
      // Already invalid on Google's side, or offline - local deletion still matters.
    }
  }
  await storage.deleteTokens(userId);
}
