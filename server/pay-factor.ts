import { and, eq, gte, isNull, lt } from "drizzle-orm";
import type { Database } from "./db/client";
import { payGrants, twoFactor, user } from "./db/schema";
import { AppError } from "./errors";
import { hiobuyPay2faRequired, sha256 } from "./platform";

const WINDOW_MS = 2 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type FactorAuth = {
  api: {
    verifyTOTP: (input: { body: { code: string }; headers: Headers }) => Promise<unknown>;
    verifyBackupCode: (input: { body: { code: string; disableSession?: boolean }; headers: Headers }) => Promise<unknown>;
  };
};

export async function payFactorState(db: Database, userId: string) {
  const required = await hiobuyPay2faRequired(db);
  const account = (await db.select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, userId)))[0];
  return { requires2fa: required, enrolled: Boolean(account?.twoFactorEnabled) };
}

/** Verifies a TOTP or recovery code and stores a one-payment grant. A repeated code cannot grant another payment. */
export async function authorizeHiobuyPay(db: Database, auth: FactorAuth, headers: Headers, userId: string, shipmentId: string, code: string) {
  if (!(await hiobuyPay2faRequired(db))) return;
  const state = await payFactorState(db, userId);
  if (!state.enrolled) throw new AppError("FORBIDDEN", "Set up an authenticator before paying HioBuy.", 403);
  const normalized = code.replace(/\s+/g, "");
  if (normalized.length < 6 || normalized.length > 32) throw new AppError("VALIDATION_ERROR", "Enter the authenticator code for this payment.");
  const since = Date.now() - ATTEMPT_WINDOW_MS;
  const recent = await db
    .select({ id: payGrants.id })
    .from(payGrants)
    .where(and(eq(payGrants.userId, userId), eq(payGrants.accepted, false), gte(payGrants.createdAt, since)));
  if (recent.length >= MAX_ATTEMPTS) throw new AppError("RATE_LIMITED", "Too many authenticator attempts. Wait a few minutes and try again.", 429);
  const accepted = await verifyFactor(auth, headers, normalized);
  const codeHash = await sha256(`${userId}:${normalized}`);
  if (!accepted) {
    await db.insert(payGrants).values({
      id: crypto.randomUUID(),
      userId,
      shipmentId,
      codeHash: crypto.randomUUID(),
      accepted: false,
      expiresAt: Date.now(),
      usedAt: null,
      createdAt: Date.now(),
    });
    throw new AppError("FORBIDDEN", "That authenticator code was not accepted.", 403);
  }
  try {
    await db.delete(payGrants).where(and(eq(payGrants.accepted, true), lt(payGrants.expiresAt, Date.now())));
    await db.insert(payGrants).values({
      id: crypto.randomUUID(),
      userId,
      shipmentId,
      codeHash,
      accepted: true,
      expiresAt: Date.now() + WINDOW_MS,
      usedAt: null,
      createdAt: Date.now(),
    });
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      throw new AppError("FORBIDDEN", "That code was already used for a payment. Wait for a new code.", 403);
    }
    throw error;
  }
}

export async function hasFreshPayGrant(db: Database, shipmentId: string) {
  if (!(await hiobuyPay2faRequired(db))) return true;
  const now = Date.now();
  const open = (
    await db
      .select({ id: payGrants.id })
      .from(payGrants)
      .where(and(eq(payGrants.shipmentId, shipmentId), eq(payGrants.accepted, true), isNull(payGrants.usedAt), gte(payGrants.expiresAt, now)))
      .limit(1)
  )[0];
  return Boolean(open);
}

export async function consumePayGrant(db: Database, shipmentId: string) {
  if (!(await hiobuyPay2faRequired(db))) return true;
  const now = Date.now();
  const open = (
    await db
      .select({ id: payGrants.id })
      .from(payGrants)
      .where(and(eq(payGrants.shipmentId, shipmentId), eq(payGrants.accepted, true), isNull(payGrants.usedAt), gte(payGrants.expiresAt, now)))
      .limit(1)
  )[0];
  if (!open) return false;
  const claimed = await db
    .update(payGrants)
    .set({ usedAt: now })
    .where(and(eq(payGrants.id, open.id), isNull(payGrants.usedAt)))
    .returning({ id: payGrants.id });
  return claimed.length > 0;
}

async function verifyFactor(auth: FactorAuth, headers: Headers, code: string) {
  try {
    await auth.api.verifyTOTP({ body: { code }, headers });
    return true;
  } catch {
    // A recovery code is the fallback when the authenticator code does not match.
  }
  try {
    await auth.api.verifyBackupCode({ body: { code, disableSession: true }, headers });
    return true;
  } catch {
    return false;
  }
}

export async function resetStaffFactor(db: Database, userId: string) {
  await db.delete(twoFactor).where(eq(twoFactor.userId, userId));
  await db.update(user).set({ twoFactorEnabled: false, updatedAt: new Date() }).where(eq(user.id, userId));
}
