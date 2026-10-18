import { decryptSecret, encryptSecret } from "./email/crypto";

/**
 * Stored form of the HioBuy API key: `enc:v1:<last four>:<AES-GCM ciphertext>`.
 * The last four characters stay readable so the settings page can show a hint without the secret.
 * A value without the prefix is a key saved before encryption and is still accepted.
 */
const PREFIX = "enc:v1:";

export function isSealedApiKey(stored: string) {
  return stored.startsWith(PREFIX);
}

export async function sealApiKey(secret: string, plain: string) {
  return `${PREFIX}${plain.slice(-4)}:${await encryptSecret(secret, plain)}`;
}

/** The plain key, or null when the stored value cannot be decrypted with this secret. */
export async function openApiKey(secret: string | undefined, stored: string): Promise<string | null> {
  if (!isSealedApiKey(stored)) return stored;
  if (!secret) return null;
  const cipher = stored.slice(PREFIX.length).split(":").slice(1).join(":");
  try {
    return await decryptSecret(secret, cipher);
  } catch {
    return null;
  }
}

export function apiKeyHint(stored: string | null) {
  if (!stored) return null;
  const tail = isSealedApiKey(stored) ? stored.slice(PREFIX.length).split(":")[0] : stored.slice(-4);
  return `••••${tail}`;
}
