import { and, desc, eq, gte, like, lte, sql } from "drizzle-orm";
import { BUSINESS_EMAIL_EVENTS, EMAIL_TEMPLATES, defaultTemplate, isTemplateId, renderTemplate, smtpHostProblem, templateProblem, type EmailTemplateId } from "../../src/domain/email";
import type { BusinessEnv } from "../../src/domain/business";
import { emailBrand } from "../business";
import type { Database } from "../db/client";
import { SINGLETON_ID, singletonRow } from "../db/singleton";
import { emailMessages, emailRules, emailSettings, emailTemplates, notificationPreferences, user } from "../db/schema";
import { AppError } from "../errors";
import { decryptSecret, encryptSecret } from "./crypto";
import { sendSmtp, testSmtp, type SmtpConfig, type SmtpEncryption } from "./smtp";

const TEST_LIMIT = 5;
const TEST_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type MailEnv = {
  BETTER_AUTH_SECRET: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_ENCRYPTION?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM_EMAIL?: string;
  SMTP_FROM_NAME?: string;
  SMTP_REPLY_TO?: string;
  APP_URL?: string;
  DEMO_MODE?: string;
};

export async function emailDeliveryConfigured(db: Database, env: MailEnv) {
  return Boolean(await resolveSmtp(db, env));
}

export async function publicSmtpView(db: Database, env: MailEnv) {
  const row = await settingsRow(db);
  const brand = await emailBrand(db, env);
  const configured = await emailDeliveryConfigured(db, env);
  return {
    configured,
    host: env.SMTP_HOST?.trim() || row.host || "",
    port: env.SMTP_PORT?.trim() ? Number(env.SMTP_PORT) : row.port || 587,
    encryption: normalizeEncryption(env.SMTP_ENCRYPTION) || (row.encryption === "tls" ? "tls" : "starttls"),
    username: env.SMTP_USERNAME?.trim() || row.username || "",
    passwordSet: Boolean(env.SMTP_PASSWORD?.trim() || row.passwordCiphertext),
    passwordFromEnvironment: Boolean(env.SMTP_PASSWORD?.trim()),
    senderName: env.SMTP_FROM_NAME?.trim() || row.senderName || "",
    senderNameFallback: brand.senderFallback,
    senderEmail: env.SMTP_FROM_EMAIL?.trim() || row.senderEmail || "",
    replyTo: env.SMTP_REPLY_TO?.trim() || row.replyTo || "",
    platformName: brand.platformName,
    logoUrl: brand.logoUrl || "",
    appUrl: brand.appUrl || "",
    hostFromEnvironment: Boolean(env.SMTP_HOST?.trim()),
  };
}

export async function saveSmtpSettings(
  db: Database,
  env: MailEnv,
  input: {
    host: string;
    port: number;
    encryption: SmtpEncryption;
    username: string;
    password: string;
    senderName: string;
    senderEmail: string;
    replyTo: string;
  },
) {
  const host = input.host.trim();
  const problem = smtpHostProblem(host);
  if (problem) throw new AppError("VALIDATION_ERROR", problem);
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new AppError("VALIDATION_ERROR", "Enter an SMTP port from 1 to 65535.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.senderEmail.trim())) throw new AppError("VALIDATION_ERROR", "Enter a sender email address.");
  if (input.replyTo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.replyTo.trim())) throw new AppError("VALIDATION_ERROR", "Reply-To must be an email address.");
  const current = await settingsRow(db);
  let passwordCiphertext = current.passwordCiphertext;
  if (input.password.trim()) passwordCiphertext = await encryptSecret(env.BETTER_AUTH_SECRET, input.password.trim());
  const now = Date.now();
  const values = {
    host,
    port: input.port,
    encryption: input.encryption,
    username: input.username.trim(),
    passwordCiphertext,
    senderName: input.senderName.trim() || null,
    senderEmail: input.senderEmail.trim(),
    replyTo: input.replyTo.trim() || null,
    updatedAt: now,
  };
  await db.update(emailSettings).set(values).where(eq(emailSettings.id, SINGLETON_ID));
  return publicSmtpView(db, env);
}

export async function checkSmtp(db: Database, env: MailEnv) {
  const config = await requireSmtp(db, env);
  try {
    await testSmtp(config);
  } catch (error) {
    throw new AppError("UPSTREAM_ERROR", error instanceof Error ? error.message : "Could not reach the mail server.", 502);
  }
  return { ok: true as const };
}

export async function sendTestEmail(db: Database, env: MailEnv, to: string) {
  await assertTestRate(db);
  const config = await requireSmtp(db, env);
  const brand = await brandOf(db, env);
  const rendered = renderTemplate({
    subject: "{{platformName}} test email",
    body: "This is a test from {{platformName}}. If you can read it, SMTP accepted the message. That does not prove the inbox delivered it.",
    vars: {},
    ...brand,
  });
  await enqueue(db, {
    idempotencyKey: `admin.test:${crypto.randomUUID()}`,
    to,
    event: "admin.test",
    templateId: "welcome",
    subject: rendered.subject,
    html: rendered.html,
    required: true,
  });
  await deliverQueued(db, env, config);
  return { ok: true as const };
}

export async function listTemplates(db: Database) {
  const rows = await db.select().from(emailTemplates);
  const saved = new Map(rows.map((row) => [row.id, row]));
  return EMAIL_TEMPLATES.map((meta) => {
    const custom = saved.get(meta.id);
    const base = defaultTemplate(meta.id);
    return { id: meta.id, name: meta.name, variables: [...meta.variables], subject: custom?.subject ?? base.subject, body: custom?.body ?? base.body, customized: Boolean(custom) };
  });
}

export async function saveTemplate(db: Database, id: string, input: { subject: string; body: string }) {
  if (!isTemplateId(id)) throw new AppError("NOT_FOUND", "Unknown email template.", 404);
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (subject.length < 1 || subject.length > 200) throw new AppError("VALIDATION_ERROR", "Subject must be 1 to 200 characters.");
  if (body.length < 1 || body.length > 8000) throw new AppError("VALIDATION_ERROR", "Body must be 1 to 8000 characters.");
  const problem = templateProblem(id, body);
  if (problem) throw new AppError("VALIDATION_ERROR", problem);
  const now = Date.now();
  const existing = (await db.select().from(emailTemplates).where(eq(emailTemplates.id, id)))[0];
  if (existing) await db.update(emailTemplates).set({ subject, body, updatedAt: now }).where(eq(emailTemplates.id, id));
  else await db.insert(emailTemplates).values({ id, subject, body, updatedAt: now });
  return listTemplates(db);
}

export async function resetTemplate(db: Database, id: string) {
  if (!isTemplateId(id)) throw new AppError("NOT_FOUND", "Unknown email template.", 404);
  await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
  return listTemplates(db);
}

export async function previewTemplate(db: Database, env: MailEnv, id: string, input?: { subject: string; body: string }) {
  const template = await templateContent(db, id);
  const brand = await brandOf(db, env);
  return renderTemplate({
    subject: input?.subject ?? template.subject,
    body: input?.body ?? template.body,
    vars: sampleVars(brand.platformName, brand.appUrl),
    ...brand,
  });
}

export async function sendTemplateTest(db: Database, env: MailEnv, id: string, to: string) {
  await assertTestRate(db);
  const config = await requireSmtp(db, env);
  const template = await templateContent(db, id);
  const brand = await brandOf(db, env);
  const rendered = renderTemplate({ ...template, vars: sampleVars(brand.platformName, brand.appUrl), ...brand });
  await enqueue(db, { idempotencyKey: `admin.test:${crypto.randomUUID()}`, to, event: "admin.test", templateId: id, subject: rendered.subject, html: rendered.html, required: true });
  await deliverQueued(db, env, config);
  return { ok: true as const };
}

export async function listRules(db: Database) {
  const rows = await db.select().from(emailRules);
  const saved = new Map(rows.map((row) => [row.event, row.enabled]));
  return {
    security: [
      { event: "email.verification", label: "Verify email address", required: true },
      { event: "email.change", label: "Verify new email address", required: true },
      { event: "email.changed", label: "Email address changed", required: true },
      { event: "password.reset", label: "Password reset", required: true },
      { event: "customer.registered", label: "Welcome email", required: true },
    ],
    business: BUSINESS_EMAIL_EVENTS.map((item) => ({ event: item.event, label: item.label, enabled: saved.get(item.event) !== false })),
  };
}

export async function saveRules(db: Database, enabled: Record<string, boolean>) {
  const allowed = new Set(BUSINESS_EMAIL_EVENTS.map((item) => item.event));
  for (const [event, value] of Object.entries(enabled)) {
    if (!allowed.has(event as (typeof BUSINESS_EMAIL_EVENTS)[number]["event"])) continue;
    const existing = (await db.select().from(emailRules).where(eq(emailRules.event, event)))[0];
    if (existing) await db.update(emailRules).set({ enabled: value }).where(eq(emailRules.event, event));
    else await db.insert(emailRules).values({ event, enabled: value });
  }
  return listRules(db);
}

export async function listMessages(db: Database, query: { status?: string; q?: string; from?: string; to?: string; page: number }) {
  const filters = [];
  if (query.status === "queued" || query.status === "sent" || query.status === "failed") filters.push(eq(emailMessages.status, query.status));
  if (query.q?.trim()) filters.push(like(emailMessages.toAddress, `%${query.q.trim().slice(0, 120)}%`));
  const from = query.from ? Date.parse(query.from) : NaN;
  const to = query.to ? Date.parse(query.to) : NaN;
  if (Number.isFinite(from)) filters.push(gte(emailMessages.createdAt, from));
  if (Number.isFinite(to)) filters.push(lte(emailMessages.createdAt, to + 24 * 60 * 60 * 1000));
  const where = filters.length ? and(...filters) : undefined;
  const pageSize = 20;
  const page = Math.max(1, query.page);
  const rows = await db.select().from(emailMessages).where(where).orderBy(desc(emailMessages.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  const totalRow = await db.select({ count: sql<number>`count(*)` }).from(emailMessages).where(where);
  return {
    page,
    pageSize,
    total: Number(totalRow[0]?.count ?? 0),
    items: rows.map((row) => ({
      id: row.id,
      to: row.toAddress,
      event: row.event,
      templateId: row.templateId,
      subject: row.subject,
      relatedType: row.relatedType,
      relatedId: row.relatedId,
      status: row.status,
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: new Date(row.createdAt).toISOString(),
      sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null,
    })),
  };
}

export async function retryMessage(db: Database, env: MailEnv, id: string) {
  const row = (await db.select().from(emailMessages).where(eq(emailMessages.id, id)))[0];
  if (!row) throw new AppError("NOT_FOUND", "That email was not found.", 404);
  if (row.status !== "failed") throw new AppError("INVALID_STATE", "Only a failed email can be retried.", 409);
  if (!row.payload) throw new AppError("INVALID_STATE", "This email no longer has a message to resend.", 409);
  if (row.attempts >= 8) throw new AppError("INVALID_STATE", "This email has been tried too many times.", 409);
  await db.update(emailMessages).set({ status: "queued", lastError: null }).where(eq(emailMessages.id, id));
  await drainEmailQueue(db, env);
  return { ok: true as const };
}

export async function enqueueSecurityEmail(
  db: Database,
  input: { to: string; name: string; templateId: "verification" | "password_reset" | "welcome" | "verify_new_email" | "email_changed"; actionUrl: string; idempotencyKey: string; detail?: string; subject?: string; body?: string },
  env: BusinessEnv = {},
) {
  const template = input.subject && input.body ? { subject: input.subject, body: input.body } : await templateContent(db, input.templateId);
  const brand = await brandOf(db, env);
  const rendered = renderTemplate({
    ...template,
    vars: { name: input.name || "there", actionUrl: input.actionUrl, platformName: brand.platformName, detail: input.detail || "", expiration_minutes: "60" },
    ...brand,
  });
  const event =
    input.templateId === "password_reset"
      ? "password.reset"
      : input.templateId === "welcome"
        ? "customer.registered"
        : input.templateId === "verify_new_email"
          ? "email.change"
          : input.templateId === "email_changed"
            ? "email.changed"
            : "email.verification";
  await enqueue(db, {
    idempotencyKey: input.idempotencyKey,
    to: input.to,
    event,
    templateId: input.templateId,
    subject: rendered.subject,
    html: rendered.html,
    required: input.templateId !== "welcome",
  });
}

export async function enqueueBusinessNotification(db: Database, userId: string, input: { type: string; body: string; href: string }) {
  const mapped = NOTIFICATION_EMAIL[input.type];
  if (!mapped) return;
  const account = (await db.select({ email: user.email, name: user.name }).from(user).where(eq(user.id, userId)))[0];
  if (!account?.email) return;
  const prefs = (await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)))[0];
  if (prefs && (!prefs.emailEnabled || !prefs[mapped.preference])) return;
  const rule = (await db.select().from(emailRules).where(eq(emailRules.event, mapped.event)))[0];
  if (rule && !rule.enabled) return;
  const template = await templateContent(db, mapped.template);
  const brand = await brandOf(db, {});
  const actionUrl = brand.appUrl ? `${brand.appUrl.replace(/\/$/, "")}${input.href.startsWith("/") ? input.href : `/${input.href}`}` : input.href;
  const publicNumber = input.body.match(/\b[A-Z][A-Z0-9-]{0,12}\d{4,}\b/)?.[0] ?? "";
  const packageNumber = mapped.event.startsWith("package") || mapped.event.startsWith("vas") ? publicNumber : "";
  const shipmentNumber = mapped.event.startsWith("shipment") || mapped.event.startsWith("shipping") ? publicNumber : "";
  const rendered = renderTemplate({
    ...template,
    vars: { name: account.name || "there", detail: input.body, actionUrl, platformName: brand.platformName, package_number: packageNumber, shipment_number: shipmentNumber },
    ...brand,
  });
  const relatedId = input.href.split("/").filter(Boolean).at(-1) ?? null;
  await enqueue(db, {
    idempotencyKey: `${mapped.event}:${userId}:${relatedId ?? input.href}`,
    to: account.email,
    event: mapped.event,
    templateId: mapped.template,
    subject: rendered.subject,
    html: rendered.html,
    required: false,
    relatedType: input.href.includes("/shipments/") ? "shipment" : "package",
    relatedId,
  });
}

export async function drainEmailQueue(db: Database, env: MailEnv) {
  const config = await resolveSmtp(db, env);
  if (!config) {
    await db.update(emailMessages).set({ status: "failed", lastError: "Mail delivery is not configured." }).where(eq(emailMessages.status, "queued"));
    return;
  }
  await deliverQueued(db, env, config);
}

async function deliverQueued(db: Database, env: MailEnv, config: SmtpConfig) {
  if (env.DEMO_MODE === "true") {
    await db.update(emailMessages).set({ status: "failed", lastError: "Demo mode does not send email." }).where(eq(emailMessages.status, "queued"));
    return;
  }
  const rows = await db.select().from(emailMessages).where(and(eq(emailMessages.status, "queued"), sql`${emailMessages.attempts} < ${MAX_ATTEMPTS}`)).limit(8);
  for (const row of rows) {
    const claimed = await db
      .update(emailMessages)
      .set({ status: "sending", attempts: sql`${emailMessages.attempts} + 1` })
      .where(and(eq(emailMessages.id, row.id), eq(emailMessages.status, "queued")))
      .returning({ id: emailMessages.id });
    if (!claimed.length || !row.payload) continue;
    try {
      await sendSmtp(config, { to: row.toAddress, subject: row.subject, html: row.payload, text: "" });
      await db.update(emailMessages).set({ status: "sent", sentAt: Date.now(), lastError: null, payload: null }).where(eq(emailMessages.id, row.id));
    } catch (error) {
      const message = (error instanceof Error ? error.message : "Send failed.").slice(0, 300);
      const attempts = row.attempts + 1;
      await db.update(emailMessages).set({ status: attempts < MAX_ATTEMPTS ? "queued" : "failed", lastError: message }).where(eq(emailMessages.id, row.id));
    }
  }
}

export async function enqueueDirect(db: Database, input: { idempotencyKey: string; to: string; event: string; templateId: string; subject: string; html: string; required: boolean }) {
  await enqueue(db, input);
}

async function enqueue(db: Database, input: { idempotencyKey: string; to: string; event: string; templateId: string; subject: string; html: string; required: boolean; relatedType?: string | null; relatedId?: string | null }) {
  try {
    await db.insert(emailMessages).values({
      id: crypto.randomUUID(),
      idempotencyKey: input.idempotencyKey,
      toAddress: input.to,
      event: input.event,
      templateId: input.templateId,
      subject: input.subject,
      payload: input.html,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      status: "queued",
      attempts: 0,
      lastError: null,
      createdAt: Date.now(),
      sentAt: null,
    });
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) return;
    throw error;
  }
}

async function assertTestRate(db: Database) {
  const since = Date.now() - TEST_WINDOW_MS;
  const rows = await db.select({ count: sql<number>`count(*)` }).from(emailMessages).where(and(eq(emailMessages.event, "admin.test"), gte(emailMessages.createdAt, since)));
  if (Number(rows[0]?.count ?? 0) >= TEST_LIMIT) throw new AppError("RATE_LIMITED", "Too many test emails. Wait a few minutes and try again.", 429);
}

async function requireSmtp(db: Database, env: MailEnv) {
  const config = await resolveSmtp(db, env);
  if (!config) throw new AppError("VALIDATION_ERROR", "Save the SMTP host, port, username, password, and sender email first.");
  return config;
}

async function resolveSmtp(db: Database, env: MailEnv): Promise<SmtpConfig | null> {
  const row = await settingsRow(db);
  const host = env.SMTP_HOST?.trim() || row.host || "";
  if (!host || smtpHostProblem(host)) return null;
  const port = env.SMTP_PORT?.trim() ? Number(env.SMTP_PORT) : row.port || 0;
  if (!Number.isInteger(port) || port < 1) return null;
  const username = env.SMTP_USERNAME?.trim() || row.username || "";
  let password = env.SMTP_PASSWORD?.trim() || "";
  if (!password && row.passwordCiphertext) {
    try {
      password = await decryptSecret(env.BETTER_AUTH_SECRET, row.passwordCiphertext);
    } catch {
      return null;
    }
  }
  const senderEmail = env.SMTP_FROM_EMAIL?.trim() || row.senderEmail || "";
  if (!username || !password || !senderEmail) return null;
  return {
    host,
    port,
    encryption: normalizeEncryption(env.SMTP_ENCRYPTION) || (row.encryption === "tls" ? "tls" : "starttls"),
    username,
    password,
    senderName: env.SMTP_FROM_NAME?.trim() || row.senderName || (await emailBrand(db, env)).senderFallback,
    senderEmail,
    replyTo: env.SMTP_REPLY_TO?.trim() || row.replyTo || null,
  };
}

function settingsRow(db: Database) {
  return singletonRow(db, emailSettings);
}

async function brandOf(db: Database, env: BusinessEnv) {
  const brand = await emailBrand(db, env);
  return {
    platformName: brand.platformName,
    logoUrl: brand.logoUrl,
    appUrl: brand.appUrl,
    primaryColor: brand.primaryColor,
    supportEmail: brand.supportEmail,
    websiteUrl: brand.websiteUrl,
  };
}

async function templateContent(db: Database, id: string) {
  if (!isTemplateId(id)) throw new AppError("NOT_FOUND", "Unknown email template.", 404);
  const custom = (await db.select().from(emailTemplates).where(eq(emailTemplates.id, id)))[0];
  return custom ? { subject: custom.subject, body: custom.body } : defaultTemplate(id);
}

function normalizeEncryption(value: string | undefined): SmtpEncryption | null {
  if (value === "tls" || value === "ssl" || value === "ssl-tls") return "tls";
  if (value === "starttls") return "starttls";
  return null;
}

function sampleVars(platformName: string, appUrl: string | null) {
  return {
    name: "Alex",
    platformName,
    detail: "PKG-10301 arrived at the warehouse.",
    actionUrl: appUrl || "https://example.com/app/packages/PKG-10301",
    package_number: "PKG-10301",
    shipment_number: "SHP-20301",
    expiration_minutes: "60",
  };
}

const NOTIFICATION_EMAIL: Record<string, { event: (typeof BUSINESS_EMAIL_EVENTS)[number]["event"]; template: EmailTemplateId; preference: (typeof BUSINESS_EMAIL_EVENTS)[number]["preference"] }> = {
  PACKAGE_RECEIVED: { event: "package.received", template: "package_received", preference: "packageReceived" },
  EXCEPTION: { event: "package.exception", template: "action_required", preference: "actionRequired" },
  VAS: { event: "vas.completed", template: "service_completed", preference: "vasCompleted" },
  PAYMENT: { event: "shipment.payment_due", template: "payment_due", preference: "paymentDue" },
  SHIPPED: { event: "shipment.shipped", template: "shipment_shipped", preference: "shipmentShipped" },
  DELIVERED: { event: "shipment.delivered", template: "shipment_delivered", preference: "shipmentDelivered" },
  TOPUP_SUCCESS: { event: "wallet.topup", template: "wallet_topup", preference: "paymentDue" },
  BANK_SUBMITTED: { event: "bank.submitted", template: "bank_submitted", preference: "paymentDue" },
  BANK_APPROVED: { event: "bank.approved", template: "bank_approved", preference: "paymentDue" },
  BANK_REJECTED: { event: "bank.rejected", template: "bank_rejected", preference: "paymentDue" },
  SHIPPING_PAID: { event: "shipping.paid", template: "shipping_paid", preference: "paymentDue" },
  PAYMENT_FAILED: { event: "payment.failed", template: "payment_failed", preference: "paymentDue" },
  REFUND_COMPLETED: { event: "refund.completed", template: "refund_completed", preference: "paymentDue" },
};
