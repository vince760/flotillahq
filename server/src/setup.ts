import fs from "node:fs";
import { env } from "./env.js";

/** Client IDs look like `1234-abc.apps.googleusercontent.com`. */
const CLIENT_ID = /^[0-9]+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i;

export type SetupResult = { ok: true } | { ok: false; message: string };

export function validateCredentials(clientId: string, clientSecret: string): SetupResult {
  if (!clientId || !clientSecret) return { ok: false, message: "Both fields are required." };
  if (!CLIENT_ID.test(clientId)) {
    return {
      ok: false,
      message:
        "That does not look like a Google client ID. It should end in .apps.googleusercontent.com",
    };
  }
  if (clientSecret.length < 10 || /\s/.test(clientSecret)) {
    return { ok: false, message: "That does not look like a client secret." };
  }
  return { ok: true };
}

/**
 * Upsert the two OAuth keys in the repo-root .env, leaving every other line -
 * comments included - exactly as the user left it.
 */
export function persistCredentials(clientId: string, clientSecret: string): void {
  const values: Record<string, string> = {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
  };

  let lines: string[] = [];
  try {
    lines = fs.readFileSync(env.envFile, "utf8").split(/\r?\n/);
  } catch {
    lines = [
      "# Written by the in-app setup panel. See README for every option.",
      "OAUTH_REDIRECT_URI=" + env.redirectUri,
      "PORT=" + String(env.port),
      "WEB_ORIGIN=" + env.webOrigin,
    ];
  }

  for (const [key, value] of Object.entries(values)) {
    const at = lines.findIndex((line) => line.trimStart().startsWith(key + "="));
    if (at === -1) lines.push(key + "=" + value);
    else lines[at] = key + "=" + value;
  }

  fs.writeFileSync(env.envFile, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
}
