import { eq, lt } from "drizzle-orm";
import { googleClientProblem, turnstileConfigError, turnstileKeyProblem } from "../src/domain/security";
import type { Database } from "./db/client";
import { SINGLETON_ID, singletonRow } from "./db/singleton";
import { platformSettings, staffMembers, turnstileTokens, user } from "./db/schema";
import { AppError } from "./errors";
import { decryptSecret, encryptSecret } from "./email/crypto";

export type PlatformEnv = {
  BETTER_AUTH_SECRET?: string;
  ENVIRONMENT?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  CUSTOMER_AI_ENABLED?: string;
};

type Row = typeof platformSettings.$inferSelect;

async function platformRow(db: Database): Promise<Row> {
  return singletonRow(db, platformSettings);
}

function authSecret(env: PlatformEnv) {
  if (!env.BETTER_AUTH_SECRET) throw new AppError("CONFIG", "Authentication secret is not configured.", 500);
  return env.BETTER_AUTH_SECRET;
}

function envFlag(value: string | undefined): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export async function customerAiEnabled(db: Database, env: PlatformEnv) {
  const forced = envFlag(env.CUSTOMER_AI_ENABLED);
  if (forced != null) return forced;
  return (await platformRow(db)).customerAiEnabled;
}

export async function hiobuyPay2faRequired(db: Database) {
  return (await platformRow(db)).hiobuyPay2fa;
}

export async function googleCredentials(db: Database, env: PlatformEnv) {
  const row = await platformRow(db);
  const clientId = env.GOOGLE_CLIENT_ID?.trim() || row.googleClientId;
  let clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() || "";
  if (!clientSecret && row.googleSecretCiphertext) {
    try {
      clientSecret = await decryptSecret(env.BETTER_AUTH_SECRET ?? "", row.googleSecretCiphertext);
    } catch {
      clientSecret = "";
    }
  }
  return { enabled: row.googleEnabled && Boolean(clientId && clientSecret), clientId, clientSecret, fromEnvironment: Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()) };
}

async function turnstileCredentials(db: Database, env: PlatformEnv) {
  const row = await platformRow(db);
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || row.turnstileSiteKey;
  let secret = env.TURNSTILE_SECRET_KEY?.trim() || "";
  if (!secret && row.turnstileSecretCiphertext) {
    try {
      secret = await decryptSecret(env.BETTER_AUTH_SECRET ?? "", row.turnstileSecretCiphertext);
    } catch {
      secret = "";
    }
  }
  return {
    enabled: row.turnstileEnabled && Boolean(siteKey && secret),
    configured: Boolean(siteKey && secret),
    siteKey,
    secret,
    login: row.turnstileLogin,
    register: row.turnstileRegister,
    reset: row.turnstileReset,
    fromEnvironment: Boolean(env.TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET_KEY?.trim()),
  };
}

export async function publicSecurity(db: Database, env: PlatformEnv) {
  const google = await googleCredentials(db, env);
  const turnstile = await turnstileCredentials(db, env);
  return {
    customerAi: await customerAiEnabled(db, env),
    google: { enabled: google.enabled },
    turnstile: {
      enabled: turnstile.enabled,
      siteKey: turnstile.enabled ? turnstile.siteKey : "",
      login: turnstile.login,
      register: turnstile.register,
      reset: turnstile.reset,
    },
  };
}

export async function adminAdvancedView(db: Database, env: PlatformEnv, origin: string) {
  const row = await platformRow(db);
  const google = await googleCredentials(db, env);
  const turnstile = await turnstileCredentials(db, env);
  const aiForced = envFlag(env.CUSTOMER_AI_ENABLED);
  return {
    numberingNote: "Saved rules apply to new records. Existing member, package, and shipment numbers stay as they are.",
    google: {
      enabled: row.googleEnabled,
      clientId: google.clientId,
      secretSet: Boolean(google.clientSecret),
      fromEnvironment: google.fromEnvironment,
      redirectUri: `${origin}/api/auth/callback/google`,
      ready: google.enabled,
    },
    turnstile: {
      enabled: row.turnstileEnabled,
      siteKey: turnstile.siteKey,
      secretSet: Boolean(turnstile.secret),
      fromEnvironment: turnstile.fromEnvironment,
      login: row.turnstileLogin,
      register: row.turnstileRegister,
      reset: row.turnstileReset,
      ready: turnstile.enabled,
    },
    customerAi: { enabled: await customerAiEnabled(db, env), locked: aiForced != null },
    hiobuyPay2fa: row.hiobuyPay2fa,
  };
}

async function writeRow(db: Database, actorId: string, patch: Partial<Row>) {
  await platformRow(db);
  await db.update(platformSettings).set({ ...patch, updatedAt: Date.now(), updatedBy: actorId }).where(eq(platformSettings.id, SINGLETON_ID));
}

export async function saveGoogleSettings(db: Database, env: PlatformEnv, actorId: string, input: { enabled: boolean; clientId: string; clientSecret: string }) {
  if (env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()) {
    await writeRow(db, actorId, { googleEnabled: input.enabled });
    return;
  }
  const current = await platformRow(db);
  const clientId = input.clientId.trim();
  if (input.enabled) {
    const problem = googleClientProblem(clientId);
    if (problem) throw new AppError("VALIDATION_ERROR", problem);
    if (!input.clientSecret.trim() && !current.googleSecretCiphertext) throw new AppError("VALIDATION_ERROR", "Enter the Google client secret.");
  }
  let googleSecretCiphertext = current.googleSecretCiphertext;
  if (input.clientSecret.trim()) googleSecretCiphertext = await encryptSecret(authSecret(env), input.clientSecret.trim());
  await writeRow(db, actorId, { googleEnabled: input.enabled, googleClientId: clientId || current.googleClientId, googleSecretCiphertext });
}

export async function saveTurnstileSettings(
  db: Database,
  env: PlatformEnv,
  actorId: string,
  input: { enabled: boolean; siteKey: string; secret: string; login: boolean; register: boolean; reset: boolean },
) {
  if (env.TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET_KEY?.trim()) {
    await writeRow(db, actorId, { turnstileEnabled: input.enabled, turnstileLogin: input.login, turnstileRegister: input.register, turnstileReset: input.reset });
    return;
  }
  const current = await platformRow(db);
  const siteKey = input.siteKey.trim();
  const secret = input.secret.trim();
  if (input.enabled && (!siteKey || (!secret && !current.turnstileSecretCiphertext))) {
    throw new AppError("VALIDATION_ERROR", "Enter the Turnstile site key and secret key.");
  }
  let turnstileSecretCiphertext = current.turnstileSecretCiphertext;
  if (secret) {
    const problem = turnstileKeyProblem(siteKey || current.turnstileSiteKey, secret, env.ENVIRONMENT === "production");
    if (problem) throw new AppError("VALIDATION_ERROR", problem);
    turnstileSecretCiphertext = await encryptSecret(authSecret(env), secret);
  }
  if (input.enabled && env.ENVIRONMENT === "production") {
    const problem = turnstileKeyProblem(siteKey || current.turnstileSiteKey, secret || "stored-secret-value", true);
    if (problem && secret) throw new AppError("VALIDATION_ERROR", problem);
  }
  await writeRow(db, actorId, {
    turnstileEnabled: input.enabled,
    turnstileSiteKey: siteKey || current.turnstileSiteKey,
    turnstileSecretCiphertext,
    turnstileLogin: input.login,
    turnstileRegister: input.register,
    turnstileReset: input.reset,
  });
}

export async function saveFeatureSettings(db: Database, env: PlatformEnv, actorId: string, input: { customerAi: boolean; hiobuyPay2fa: boolean }) {
  if (envFlag(env.CUSTOMER_AI_ENABLED) != null && input.customerAi !== (env.CUSTOMER_AI_ENABLED === "true")) {
    throw new AppError("VALIDATION_ERROR", "Customer AI is set by the deployment and cannot be changed here.");
  }
  await writeRow(db, actorId, { customerAiEnabled: input.customerAi, hiobuyPay2fa: input.hiobuyPay2fa });
}

export async function checkGoogle(db: Database, env: PlatformEnv, origin: string) {
  const google = await googleCredentials(db, env);
  if (!google.clientId || !google.clientSecret) return { ok: false as const, message: "Add a client ID and client secret first." };
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: "invalid",
    client_id: google.clientId,
    client_secret: google.clientSecret,
    redirect_uri: `${origin}/api/auth/callback/google`,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (payload.error === "invalid_grant" || payload.error === "invalid_request") return { ok: true as const, message: "Google accepted the client ID and secret." };
  if (payload.error === "invalid_client") return { ok: false as const, message: "Google rejected the client ID or secret." };
  return { ok: false as const, message: "Google did not confirm this OAuth client." };
}

export async function checkTurnstile(db: Database, env: PlatformEnv) {
  const turnstile = await turnstileCredentials(db, env);
  if (!turnstile.siteKey || !turnstile.secret) return { ok: false as const, message: "Add a site key and secret key first." };
  const problem = turnstileKeyProblem(turnstile.siteKey, turnstile.secret, env.ENVIRONMENT === "production");
  if (problem) return { ok: false as const, message: problem };
  const result = await siteverify(turnstile.secret, "configuration-check", null);
  if (turnstileConfigError(result.codes)) return { ok: false as const, message: "Cloudflare rejected the Turnstile secret." };
  if (result.codes.includes("invalid-input-response") || result.codes.includes("timeout-or-duplicate") || result.ok) {
    return { ok: true as const, message: "Cloudflare accepted the Turnstile secret." };
  }
  return { ok: false as const, message: "Turnstile did not accept this configuration." };
}

export async function assertTurnstile(db: Database, env: PlatformEnv, input: { action: "login" | "register" | "reset"; token: string; ip: string | null; email: string }) {
  const turnstile = await turnstileCredentials(db, env);
  if (!turnstile.enabled) return;
  const needed = input.action === "login" ? turnstile.login : input.action === "register" ? turnstile.register : turnstile.reset;
  if (!needed) return;
  if (!input.token) throw new Error("Complete the security check and try again.");
  const seen = await rememberTurnstileToken(db, input.token);
  if (!seen) throw new Error("Complete the security check and try again.");
  const result = await siteverify(turnstile.secret, input.token, input.ip);
  if (result.ok) return;
  const ownerCanPass = turnstileConfigError(result.codes) || result.codes.includes("internal-error");
  if (ownerCanPass && (await isActiveOwnerEmail(db, input.email))) return;
  throw new Error("Complete the security check and try again.");
}

async function rememberTurnstileToken(db: Database, token: string) {
  const tokenHash = await sha256(token);
  await db.delete(turnstileTokens).where(lt(turnstileTokens.createdAt, Date.now() - 24 * 60 * 60 * 1000));
  try {
    await db.insert(turnstileTokens).values({ tokenHash, createdAt: Date.now() });
    return true;
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return false;
    throw error;
  }
}

async function siteverify(secret: string, token: string, ip: string | null) {
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const payload = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    return { ok: payload.success === true, codes: payload["error-codes"] ?? [] };
  } catch {
    return { ok: false, codes: ["internal-error"] };
  }
}

async function isActiveOwnerEmail(db: Database, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const rows = await db
    .select({ role: staffMembers.role, status: staffMembers.status, email: user.email })
    .from(staffMembers)
    .innerJoin(user, eq(user.id, staffMembers.userId));
  return rows.some((row) => row.role === "owner" && row.status === "active" && row.email.toLowerCase() === normalized);
}

export async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
