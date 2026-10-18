import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import type { Database } from "./db/client";
import { account, emailChangeCodes, emailChangeRequests, session, user } from "./db/schema";
import { enqueueSecurityEmail } from "./email/mailer";
import { AppError } from "./errors";
import { sha256 } from "./platform";
import type { BusinessEnv } from "../src/domain/business";

type MailEnv = BusinessEnv & { BETTER_AUTH_SECRET: string };

const HOUR = 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function accountSecurityView(db: Database, userId: string) {
  const accounts = await db.select({ providerId: account.providerId, password: account.password }).from(account).where(eq(account.userId, userId));
  const pending = (
    await db.select().from(emailChangeRequests).where(and(eq(emailChangeRequests.userId, userId), isNull(emailChangeRequests.usedAt))).limit(1)
  )[0];
  const open = pending && pending.expiresAt > Date.now() ? pending : null;
  return {
    hasPassword: accounts.some((item) => item.providerId === "credential" && Boolean(item.password)),
    googleLinked: accounts.some((item) => item.providerId === "google"),
    pendingEmail: open ? { email: open.newEmail, expiresAt: new Date(open.expiresAt).toISOString() } : null,
  };
}

export async function sendCurrentEmailCode(db: Database, env: MailEnv, userId: string, origin: string) {
  const accountRow = (await db.select({ email: user.email, name: user.name }).from(user).where(eq(user.id, userId)))[0];
  if (!accountRow) throw new AppError("NOT_FOUND", "Account not found.", 404);
  const since = Date.now() - HOUR;
  const recent = await db.select({ count: sql<number>`count(*)` }).from(emailChangeCodes).where(and(eq(emailChangeCodes.userId, userId), gte(emailChangeCodes.createdAt, since)));
  if (Number(recent[0]?.count ?? 0) >= 3) throw new AppError("RATE_LIMITED", "Too many confirmation codes. Wait an hour and try again.", 429);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  await db.insert(emailChangeCodes).values({
    id: crypto.randomUUID(),
    userId,
    codeHash: await sha256(`${env.BETTER_AUTH_SECRET}:${code}`),
    expiresAt: Date.now() + 10 * 60 * 1000,
    createdAt: Date.now(),
    usedAt: null,
  });
  await enqueueSecurityEmail(
    db,
    {
      to: accountRow.email,
      name: accountRow.name,
      templateId: "verification",
      actionUrl: origin,
      idempotencyKey: `email-challenge:${userId}:${crypto.randomUUID()}`,
      detail: code,
      subject: "Confirm it's you",
      body: "Hello {{customer_name}},\n\nYour confirmation code is {{detail}}. It expires in 10 minutes. If you did not request an email change, you can ignore this message.",
    },
    env,
  );
  return { ok: true as const };
}

export async function requestEmailChange(
  db: Database,
  env: MailEnv,
  userId: string,
  origin: string,
  input: { email: string; password: string; code: string },
) {
  const nextEmail = input.email.trim().toLowerCase();
  if (!EMAIL.test(nextEmail) || nextEmail.length > 200) throw new AppError("VALIDATION_ERROR", "Enter a valid email address.");
  const current = (await db.select().from(user).where(eq(user.id, userId)))[0];
  if (!current) throw new AppError("NOT_FOUND", "Account not found.", 404);
  if (current.email.toLowerCase() === nextEmail) throw new AppError("VALIDATION_ERROR", "That is already your email.");
  const taken = (await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${nextEmail}`).limit(1))[0];
  if (taken) throw new AppError("VALIDATION_ERROR", "That email is already used by another account.");
  await assertIdentity(db, env, userId, input.password, input.code);
  await assertSendRate(db, userId);
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  await db.delete(emailChangeRequests).where(and(eq(emailChangeRequests.userId, userId), isNull(emailChangeRequests.usedAt)));
  await db.insert(emailChangeRequests).values({
    id: crypto.randomUUID(),
    userId,
    newEmail: nextEmail,
    tokenHash: await sha256(`${env.BETTER_AUTH_SECRET}:${token}`),
    expiresAt: Date.now() + HOUR,
    createdAt: Date.now(),
    usedAt: null,
  });
  await enqueueSecurityEmail(
    db,
    {
      to: nextEmail,
      name: current.name,
      templateId: "verify_new_email",
      actionUrl: `${origin}/auth/confirm-email?token=${encodeURIComponent(token)}`,
      idempotencyKey: `email-change:${userId}:${await sha256(token)}`,
      detail: nextEmail,
    },
    env,
  );
  return { pendingEmail: nextEmail };
}

export async function resendEmailChange(db: Database, env: MailEnv, userId: string, origin: string) {
  const pending = (await db.select().from(emailChangeRequests).where(and(eq(emailChangeRequests.userId, userId), isNull(emailChangeRequests.usedAt))).limit(1))[0];
  if (!pending) throw new AppError("INVALID_STATE", "There is no email change waiting for confirmation.", 409);
  const current = (await db.select({ name: user.name }).from(user).where(eq(user.id, userId)))[0];
  await assertSendRate(db, userId);
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  await db.delete(emailChangeRequests).where(eq(emailChangeRequests.id, pending.id));
  await db.insert(emailChangeRequests).values({
    id: crypto.randomUUID(),
    userId,
    newEmail: pending.newEmail,
    tokenHash: await sha256(`${env.BETTER_AUTH_SECRET}:${token}`),
    expiresAt: Date.now() + HOUR,
    createdAt: Date.now(),
    usedAt: null,
  });
  await enqueueSecurityEmail(
    db,
    {
      to: pending.newEmail,
      name: current?.name || "there",
      templateId: "verify_new_email",
      actionUrl: `${origin}/auth/confirm-email?token=${encodeURIComponent(token)}`,
      idempotencyKey: `email-change:${userId}:${await sha256(token)}`,
      detail: pending.newEmail,
    },
    env,
  );
  return { pendingEmail: pending.newEmail };
}

export async function cancelEmailChange(db: Database, userId: string) {
  await db.delete(emailChangeRequests).where(and(eq(emailChangeRequests.userId, userId), isNull(emailChangeRequests.usedAt)));
  return { ok: true as const };
}

export async function confirmEmailChange(db: Database, env: MailEnv, token: string) {
  if (token.length < 20 || token.length > 200) throw new AppError("VALIDATION_ERROR", "This confirmation link is incomplete.");
  const tokenHash = await sha256(`${env.BETTER_AUTH_SECRET}:${token}`);
  const pending = (await db.select().from(emailChangeRequests).where(eq(emailChangeRequests.tokenHash, tokenHash)).limit(1))[0];
  if (!pending || pending.usedAt) throw new AppError("INVALID_STATE", "This confirmation link is invalid or already used.", 409);
  if (pending.expiresAt <= Date.now()) throw new AppError("INVALID_STATE", "This confirmation link has expired. Request a new one.", 409);
  const current = (await db.select().from(user).where(eq(user.id, pending.userId)))[0];
  if (!current) throw new AppError("NOT_FOUND", "Account not found.", 404);
  const taken = (await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${pending.newEmail}`).limit(1))[0];
  if (taken && taken.id !== current.id) throw new AppError("INVALID_STATE", "That email is already used by another account.", 409);
  const claimed = await db
    .update(emailChangeRequests)
    .set({ usedAt: Date.now() })
    .where(and(eq(emailChangeRequests.id, pending.id), isNull(emailChangeRequests.usedAt)))
    .returning({ id: emailChangeRequests.id });
  if (!claimed.length) throw new AppError("INVALID_STATE", "This confirmation link is invalid or already used.", 409);
  const previous = current.email;
  await db.update(user).set({ email: pending.newEmail, emailVerified: true, updatedAt: new Date() }).where(eq(user.id, current.id));
  await db.delete(session).where(eq(session.userId, current.id));
  await db.delete(emailChangeRequests).where(and(eq(emailChangeRequests.userId, current.id), isNull(emailChangeRequests.usedAt)));
  await enqueueSecurityEmail(
    db,
    {
      to: previous,
      name: current.name,
      templateId: "email_changed",
      actionUrl: "",
      idempotencyKey: `email-changed:${current.id}:${await sha256(pending.newEmail)}`,
      detail: pending.newEmail,
    },
    env,
  );
  return { email: pending.newEmail };
}

export async function unlinkGoogle(db: Database, userId: string, password: string) {
  const view = await accountSecurityView(db, userId);
  if (!view.googleLinked) throw new AppError("INVALID_STATE", "Google is not linked to this account.", 409);
  if (!view.hasPassword) throw new AppError("INVALID_STATE", "Set a password before unlinking Google, so you can still sign in.", 409);
  await assertPassword(db, userId, password);
  await db.delete(account).where(and(eq(account.userId, userId), eq(account.providerId, "google")));
  return { ok: true as const };
}

async function assertIdentity(db: Database, env: MailEnv, userId: string, password: string, code: string) {
  const view = await accountSecurityView(db, userId);
  if (view.hasPassword) {
    await assertPassword(db, userId, password);
    return;
  }
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) throw new AppError("VALIDATION_ERROR", "Enter the code sent to your current email.");
  const hash = await sha256(`${env.BETTER_AUTH_SECRET}:${normalized}`);
  const row = (
    await db
      .select()
      .from(emailChangeCodes)
      .where(and(eq(emailChangeCodes.userId, userId), eq(emailChangeCodes.codeHash, hash), isNull(emailChangeCodes.usedAt)))
      .limit(1)
  )[0];
  if (!row || row.expiresAt <= Date.now()) throw new AppError("FORBIDDEN", "That code is invalid or expired.", 403);
  const claimed = await db
    .update(emailChangeCodes)
    .set({ usedAt: Date.now() })
    .where(and(eq(emailChangeCodes.id, row.id), isNull(emailChangeCodes.usedAt)))
    .returning({ id: emailChangeCodes.id });
  if (!claimed.length) throw new AppError("FORBIDDEN", "That code is invalid or expired.", 403);
}

async function assertPassword(db: Database, userId: string, password: string) {
  const credential = (await db.select({ password: account.password }).from(account).where(and(eq(account.userId, userId), eq(account.providerId, "credential"))).limit(1))[0];
  if (!credential?.password || !(await verifyPassword({ hash: credential.password, password }))) {
    throw new AppError("FORBIDDEN", "Current password was not accepted.", 403);
  }
}

async function assertSendRate(db: Database, userId: string) {
  const since = Date.now() - HOUR;
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(emailChangeRequests)
    .where(and(eq(emailChangeRequests.userId, userId), gte(emailChangeRequests.createdAt, since)));
  if (Number(rows[0]?.count ?? 0) >= 5) throw new AppError("RATE_LIMITED", "Too many email change messages. Wait an hour and try again.", 429);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
