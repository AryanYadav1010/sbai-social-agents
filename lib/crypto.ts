import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// AES-256-GCM, key derived from a single env secret. Only ever called from
// server-side API routes/agents (never middleware), so Node's crypto module
// is fine here -- no edge-runtime constraint to work around.
const SECRET = process.env.TOKEN_ENCRYPTION_KEY;

function getKey(): Buffer {
  if (!SECRET) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set -- cannot encrypt/decrypt stored OAuth tokens.");
  }
  return scryptSync(SECRET, "sbai-social-agents-token-salt", 32);
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv.authTag.ciphertext, all base64, concatenated with a delimiter that
  // can't appear in base64 output.
  return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  const [ivB64, authTagB64, dataB64] = stored.split(".");
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Stored token is not in the expected encrypted format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
