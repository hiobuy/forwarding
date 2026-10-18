import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { INVITE_TTL_MS, inviteState, isStaffRole, lastOwnerBlocked, permissionsOf, type StaffRole } from "../src/domain/staff";
import type { Database } from "./db/client";
import { auditLogs, emailOutbox, session, staffInvites, staffMembers, user } from "./db/schema";
import { enqueueDirect } from "./email/mailer";
import { AppError } from "./errors";

export type StaffActor = { id: string; email: string; role: StaffRole };

const LAST_OWNER = "The last owner can't be removed, disabled, or changed to another role.";

export function adminEmailList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export async function recordAudit(
  db: Database,
  actor: { id: string; email: string },
  action: string,
  target: string | null,
  detail?: Record<string, unknown>,
) {
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorId: actor.id,
    actorEmail: actor.email,
    action,
    target,
    detail: detail ? JSON.stringify(detail) : null,
    createdAt: Date.now(),
  });
}

export async function activeStaffRole(db: Database, userId: string): Promise<StaffRole | null> {
  const row = (await db.select({ role: staffMembers.role, status: staffMembers.status }).from(staffMembers).where(eq(staffMembers.userId, userId)))[0];
  if (!row || row.status !== "active" || !isStaffRole(row.role)) return null;
  return row.role;
}

/** True when this signed-in account may see the admin link before or after bootstrap. */
export async function adminLinkVisible(db: Database, userId: string, email: string, adminEmails: string | undefined): Promise<boolean> {
  if (await activeStaffRole(db, userId)) return true;
  return bootstrapCandidate(db, email, adminEmails);
}

async function bootstrapCandidate(db: Database, email: string, adminEmails: string | undefined): Promise<boolean> {
  const wanted = adminEmailList(adminEmails);
  if (!wanted.includes(email.trim().toLowerCase())) return false;
  const owners = await db.select({ userId: staffMembers.userId }).from(staffMembers).where(eq(staffMembers.role, "owner")).limit(1);
  return owners.length === 0;
}

/**
 * Active staff may enter. When no owner row exists yet, every existing user whose email is in ADMIN_EMAILS becomes an owner.
 * Signup never inserts a staff row.
 */
export async function authorizeStaff(db: Database, current: { id: string; email: string }, adminEmails: string | undefined): Promise<StaffActor> {
  await bootstrapOwners(db, adminEmails);
  const row = (await db.select().from(staffMembers).where(eq(staffMembers.userId, current.id)))[0];
  if (!row || !isStaffRole(row.role)) {
    throw new AppError("FORBIDDEN", "This account is not on the team. Ask an owner to invite you.", 403);
  }
  if (row.status !== "active") {
    throw new AppError("FORBIDDEN", "This staff account is disabled.", 403);
  }
  await touchLastLogin(db, current.id);
  return { id: current.id, email: current.email, role: row.role };
}

async function bootstrapOwners(db: Database, adminEmails: string | undefined) {
  const existing = await db.select({ userId: staffMembers.userId }).from(staffMembers).where(eq(staffMembers.role, "owner")).limit(1);
  if (existing.length) return;
  const wanted = new Set(adminEmailList(adminEmails));
  if (!wanted.size) return;
  const accounts = await db.select({ id: user.id, email: user.email }).from(user);
  const now = Date.now();
  const matches = accounts.filter((account) => wanted.has(account.email.trim().toLowerCase()));
  for (const account of matches) {
    const already = (await db.select({ userId: staffMembers.userId }).from(staffMembers).where(eq(staffMembers.userId, account.id)))[0];
    if (already) continue;
    await db.insert(staffMembers).values({
      userId: account.id,
      role: "owner",
      status: "active",
      invitedBy: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await recordAudit(db, { id: account.id, email: account.email }, "staff.bootstrap", account.id, { role: "owner" });
  }
}

async function touchLastLogin(db: Database, userId: string) {
  const latest = (await db.select({ createdAt: session.createdAt }).from(session).where(eq(session.userId, userId)).orderBy(desc(session.createdAt)).limit(1))[0];
  if (!latest) return;
  const at = latest.createdAt instanceof Date ? latest.createdAt.getTime() : Number(latest.createdAt);
  if (!Number.isFinite(at)) return;
  await db
    .update(staffMembers)
    .set({ lastLoginAt: at })
    .where(and(eq(staffMembers.userId, userId), sql`${staffMembers.lastLoginAt} is null or ${staffMembers.lastLoginAt} < ${at}`));
}

export async function teamSnapshot(db: Database) {
  const [members, invites, audit] = await Promise.all([
    db
      .select({
        userId: staffMembers.userId,
        role: staffMembers.role,
        status: staffMembers.status,
        lastLoginAt: staffMembers.lastLoginAt,
        createdAt: staffMembers.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(staffMembers)
      .innerJoin(user, eq(user.id, staffMembers.userId))
      .orderBy(desc(staffMembers.createdAt)),
    db.select().from(staffInvites).where(isNull(staffInvites.usedAt)).orderBy(desc(staffInvites.createdAt)),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(30),
  ]);
  const now = Date.now();
  return {
    members: members.map((member) => ({
      ...member,
      lastLoginAt: member.lastLoginAt ? new Date(member.lastLoginAt).toISOString() : null,
      createdAt: new Date(member.createdAt).toISOString(),
    })),
    invites: invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: new Date(invite.expiresAt).toISOString(),
      state: inviteState({ usedAt: invite.usedAt, expiresAt: invite.expiresAt }, now),
    })),
    audit: audit.map((entry) => ({
      id: entry.id,
      actorEmail: entry.actorEmail,
      action: entry.action,
      target: entry.target,
      createdAt: new Date(entry.createdAt).toISOString(),
    })),
  };
}

export async function inviteStaff(db: Database, actor: StaffActor, input: { email: string; role: StaffRole }, origin: string, devMailbox: boolean) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("VALIDATION_ERROR", "Enter a valid email.");
  const existing = await findUserByEmail(db, email);
  if (existing) {
    const staff = (await db.select().from(staffMembers).where(eq(staffMembers.userId, existing.id)))[0];
    if (staff?.status === "active") throw new AppError("CONFLICT", "That person is already on the team.", 409);
    if (staff?.status === "disabled") throw new AppError("CONFLICT", "That person is disabled. Enable them instead of sending a new invite.", 409);
  }
  const token = newToken();
  const now = Date.now();
  await db.delete(staffInvites).where(and(eq(staffInvites.email, email), isNull(staffInvites.usedAt)));
  await db.insert(staffInvites).values({
    id: crypto.randomUUID(),
    email,
    role: input.role,
    tokenHash: await sha256(token),
    expiresAt: now + INVITE_TTL_MS,
    usedAt: null,
    invitedBy: actor.id,
    createdAt: now,
  });
  const inviteUrl = `${origin}/auth/invite?token=${encodeURIComponent(token)}`;
  await deliverInvite(db, email, input.role, inviteUrl, devMailbox);
  await recordAudit(db, actor, "staff.invite", email, { role: input.role });
  return { email, role: input.role, expiresAt: new Date(now + INVITE_TTL_MS).toISOString(), inviteUrl };
}

async function deliverInvite(db: Database, email: string, role: StaffRole, inviteUrl: string, devMailbox: boolean) {
  const subject = "You're invited to the HIOBuy team";
  const body = `Accept this ${role} invite within 7 days. The link works once.`;
  if (devMailbox) await db.insert(emailOutbox).values({ id: crypto.randomUUID(), toAddress: email, kind: "staff-invite", subject, body, url: inviteUrl, createdAt: Date.now() });
  try {
    await enqueueDirect(db, {
      idempotencyKey: `staff.invite:${email}:${inviteUrl}`,
      to: email,
      event: "staff.invite",
      templateId: "welcome",
      subject,
      html: `<p>${body}</p><p><a href="${inviteUrl}">Accept invite</a></p>`,
      required: true,
    });
  } catch {
    /* The owner still has the link in the response. */
  }
}

export async function revokeInvite(db: Database, actor: StaffActor, id: string) {
  const removed = await db.delete(staffInvites).where(and(eq(staffInvites.id, id), isNull(staffInvites.usedAt))).returning({ email: staffInvites.email });
  if (!removed.length) throw new AppError("NOT_FOUND", "That invite is no longer open.", 404);
  await recordAudit(db, actor, "staff.invite.revoke", removed[0]?.email ?? id, {});
  return { id };
}

export async function previewInvite(db: Database, token: string) {
  const invite = await openInvite(db, token);
  const existing = await findUserByEmail(db, invite.email);
  return { email: invite.email, role: invite.role, expiresAt: new Date(invite.expiresAt).toISOString(), hasAccount: Boolean(existing) };
}

export async function acceptInvite(
  db: Database,
  auth: { api: { signUpEmail: (input: { body: { email: string; password: string; name: string } }) => Promise<unknown> } },
  input: { token: string; name?: string; password?: string; sessionEmail: string | null },
) {
  const invite = await openInvite(db, input.token);
  let account = await findUserByEmail(db, invite.email);
  if (account) {
    const staff = (await db.select().from(staffMembers).where(eq(staffMembers.userId, account.id)))[0];
    if (staff?.status === "active") throw new AppError("CONFLICT", "This account is already on the team.", 409);
    if (staff?.status === "disabled") throw new AppError("CONFLICT", "This account is disabled. Ask an owner to enable it.", 409);
    if (!input.sessionEmail || input.sessionEmail.trim().toLowerCase() !== invite.email) {
      throw new AppError("UNAUTHENTICATED", `Sign in as ${invite.email} to accept this invite.`, 401);
    }
  } else {
    const name = input.name?.trim() ?? "";
    const password = input.password ?? "";
    if (name.length < 1 || name.length > 80) throw new AppError("VALIDATION_ERROR", "Enter your name.");
    if (password.length < 8) throw new AppError("VALIDATION_ERROR", "Use at least 8 characters for the password.");
    try {
      await auth.api.signUpEmail({ body: { email: invite.email, password, name } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create the account.";
      throw new AppError("VALIDATION_ERROR", message);
    }
    account = await findUserByEmail(db, invite.email);
    if (!account) throw new AppError("INTERNAL", "The account was not created.", 500);
    await db.update(user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(user.id, account.id));
  }
  const now = Date.now();
  const claimed = await db
    .update(staffInvites)
    .set({ usedAt: now })
    .where(and(eq(staffInvites.id, invite.id), isNull(staffInvites.usedAt)))
    .returning({ id: staffInvites.id });
  if (!claimed.length) throw new AppError("CONFLICT", "This invite was already used.", 409);
  await db.insert(staffMembers).values({
    userId: account.id,
    role: invite.role,
    status: "active",
    invitedBy: invite.invitedBy,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await recordAudit(db, { id: account.id, email: account.email }, "staff.accept", account.id, { role: invite.role });
  return { email: account.email, role: invite.role };
}

export async function changeStaffRole(db: Database, actor: StaffActor, userId: string, role: StaffRole) {
  const target = await requireMember(db, userId);
  if (lastOwnerBlocked({ activeOwnerCount: await activeOwnerCount(db), targetRole: target.role, targetStatus: target.status, action: "role", nextRole: role })) {
    throw new AppError("CONFLICT", LAST_OWNER, 409);
  }
  const updated = await db
    .update(staffMembers)
    .set({ role, updatedAt: Date.now() })
    .where(and(eq(staffMembers.userId, userId), lastOwnerGuard(role === "owner")))
    .returning({ userId: staffMembers.userId });
  if (!updated.length) throw new AppError("CONFLICT", LAST_OWNER, 409);
  await recordAudit(db, actor, "staff.role", userId, { role });
  return { userId, role };
}

export async function setStaffStatus(db: Database, actor: StaffActor, userId: string, status: "active" | "disabled") {
  const target = await requireMember(db, userId);
  if (status === "disabled" && lastOwnerBlocked({ activeOwnerCount: await activeOwnerCount(db), targetRole: target.role, targetStatus: target.status, action: "disable" })) {
    throw new AppError("CONFLICT", LAST_OWNER, 409);
  }
  const updated = await db
    .update(staffMembers)
    .set({ status, updatedAt: Date.now() })
    .where(and(eq(staffMembers.userId, userId), status === "disabled" ? lastOwnerGuard(false) : undefined))
    .returning({ userId: staffMembers.userId });
  if (!updated.length) throw new AppError("CONFLICT", LAST_OWNER, 409);
  if (status === "disabled") await db.delete(session).where(eq(session.userId, userId));
  await recordAudit(db, actor, status === "disabled" ? "staff.disable" : "staff.enable", userId, {});
  return { userId, status };
}

export async function removeStaff(db: Database, actor: StaffActor, userId: string) {
  const target = await requireMember(db, userId);
  if (lastOwnerBlocked({ activeOwnerCount: await activeOwnerCount(db), targetRole: target.role, targetStatus: target.status, action: "remove" })) {
    throw new AppError("CONFLICT", LAST_OWNER, 409);
  }
  const removed = await db.delete(staffMembers).where(and(eq(staffMembers.userId, userId), lastOwnerGuard(false))).returning({ userId: staffMembers.userId });
  if (!removed.length) throw new AppError("CONFLICT", LAST_OWNER, 409);
  await db.delete(session).where(eq(session.userId, userId));
  await recordAudit(db, actor, "staff.remove", userId, { role: target.role });
  return { userId };
}

export async function noteSecurityEvent(db: Database, actor: StaffActor, event: "mfa.enabled" | "mfa.disabled", enabled: boolean) {
  if (event === "mfa.enabled" && !enabled) throw new AppError("CONFLICT", "Turn on the authenticator before recording it.", 409);
  if (event === "mfa.disabled" && enabled) throw new AppError("CONFLICT", "The authenticator is still on.", 409);
  await recordAudit(db, actor, event, actor.id, {});
  return { event };
}

export function staffMe(actor: StaffActor, mfaEnabled: boolean) {
  return { email: actor.email, role: actor.role, permissions: permissionsOf(actor.role), mfaEnabled };
}

async function requireMember(db: Database, userId: string) {
  const target = (await db.select().from(staffMembers).where(eq(staffMembers.userId, userId)))[0];
  if (!target || !isStaffRole(target.role) || (target.status !== "active" && target.status !== "disabled")) {
    throw new AppError("NOT_FOUND", "That staff member was not found.", 404);
  }
  return { role: target.role, status: target.status as "active" | "disabled" };
}

async function activeOwnerCount(db: Database) {
  const rows = await db.select({ userId: staffMembers.userId }).from(staffMembers).where(and(eq(staffMembers.role, "owner"), eq(staffMembers.status, "active")));
  return rows.length;
}

/** Keeps the update from applying when it would remove the only active owner. Pass allow when the next role is still owner. */
function lastOwnerGuard(allow: boolean) {
  if (allow) return sql`1 = 1`;
  return sql`NOT (${staffMembers.role} = 'owner' AND ${staffMembers.status} = 'active' AND (SELECT count(*) FROM staff_members WHERE role = 'owner' AND status = 'active') <= 1)`;
}

async function openInvite(db: Database, token: string) {
  const invite = (await db.select().from(staffInvites).where(eq(staffInvites.tokenHash, await sha256(token))))[0];
  if (!invite || !isStaffRole(invite.role)) throw new AppError("NOT_FOUND", "This invite is not valid.", 404);
  const state = inviteState({ usedAt: invite.usedAt, expiresAt: invite.expiresAt }, Date.now());
  if (state === "used") throw new AppError("CONFLICT", "This invite was already used.", 409);
  if (state === "expired") throw new AppError("CONFLICT", "This invite has expired. Ask an owner to send a new one.", 409);
  return invite;
}

async function findUserByEmail(db: Database, email: string) {
  return (await db.select().from(user).where(sql`lower(${user.email}) = ${email}`))[0] ?? null;
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
