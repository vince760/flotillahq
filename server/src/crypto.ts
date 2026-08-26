import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.js";

/**
 * AES-256-GCM for refresh tokens at rest. A leaked database file should not hand
 * over live access to anyone's Analytics account.
 *
 * The key comes from ENCRYPTION_KEY (32 bytes, base64). In development one is
 * generated and kept in data/encryption.key so nobody has to think about it;
 * in production a missing key is fatal rather than silently regenerated, because
 * regenerating it would quietly invalidate every stored token.
 */

const KEY_FILE = "encryption.key";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(): Buffer {
  const fromEnv = process.env.ENCRYPTION_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.length !== 32) {
      throw new Error("ENCRYPTION_KEY must be exactly 32 bytes, base64-encoded.");
    }
    return key;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ENCRYPTION_KEY is required in production. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  const keyPath = path.join(env.dataDir, KEY_FILE);
  try {
    const key = Buffer.from(fs.readFileSync(keyPath, "utf8").trim(), "base64");
    if (key.length === 32) return key;
  } catch {
    /* fall through and create one */
  }

  const key = randomBytes(32);
  fs.mkdirSync(env.dataDir, { recursive: true });
  fs.writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
  console.warn(
    "[flotilla] Generated a development encryption key at data/" +
      KEY_FILE +
      ". Set ENCRYPTION_KEY from a secret manager before deploying.",
  );
  return key;
}

let key: Buffer | null = null;
const getKey = () => (key ??= loadKey());

/** Returns base64 of iv | ciphertext | authTag. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64");
}

export function decrypt(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("Ciphertext is truncated.");

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** URL-safe random identifier for sessions and OAuth nonces. */
export const token = (bytes = 32) => randomBytes(bytes).toString("base64url");
