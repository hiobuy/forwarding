import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import Stripe from "stripe";
import { stripeKeyModeProblem } from "../src/domain/payments";
import type { Database } from "./db/client";
import { SINGLETON_ID, singletonRow } from "./db/singleton";
import { bankAccounts, bankTransfers, charges, checkouts, paymentEvents, paymentSettings, payments, refundRecords, shipments, user } from "./db/schema";
import { decryptSecret, encryptSecret } from "./email/crypto";
import { notify } from "./notify";
import { moveWallet } from "./wallet";
import { AppError } from "./errors";
import { customerCurrency } from "./locale";


type PayEnv = { BETTER_AUTH_SECRET?: string; APP_URL?: string };

function authSecret(env: PayEnv) {
  if (!env.BETTER_AUTH_SECRET) throw new AppError("VALIDATION_ERROR", "Server auth secret is not configured.");
  return env.BETTER_AUTH_SECRET;
}

export type BankAccountInput = {
  id: string;
  label: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  swift: string;
  country: string;
  currency: string;
  instructions: string;
};

function presentBankAccount(row: typeof bankAccounts.$inferSelect): BankAccountInput {
  return {
    id: row.id,
    label: row.label ?? "",
    bankName: row.bankName,
    accountHolder: row.accountHolder,
    accountNumber: row.accountNumber,
    swift: row.swift ?? "",
    country: row.country ?? "",
    currency: row.currency || "USD",
    instructions: row.instructions ?? "",
  };
}

async function listBankAccounts(db: Database) {
  const rows = await db.select().from(bankAccounts).orderBy(asc(bankAccounts.sortOrder), asc(bankAccounts.createdAt));
  return rows.map(presentBankAccount);
}

export async function paymentOptions(db: Database) {
  const row = await settingsRow(db);
  const accounts = row.bankEnabled ? await listBankAccounts(db) : [];
  const stripeReady = Boolean(row.stripeEnabled && row.stripePublishableKey && row.stripeSecretCiphertext);
  return {
    currency: await customerCurrency(db),
    stripe: stripeReady,
    publishableKey: stripeReady ? row.stripePublishableKey : null,
    cardTopup: Boolean(stripeReady && row.cardTopupEnabled),
    bank: accounts.length > 0,
    bankAccounts: accounts,
    bankDetails: accounts[0] ?? null,
    minTopupFen: row.minTopupFen,
    maxTopupFen: row.maxTopupFen,
  };
}

export async function publicPaymentSettings(db: Database) {
  const row = await settingsRow(db);
  const stripeReady = Boolean(row.stripeEnabled && row.stripePublishableKey && row.stripeSecretCiphertext && row.stripeWebhookCiphertext);
  const accounts = await listBankAccounts(db);
  const bankReady = Boolean(row.bankEnabled && accounts.length);
  const first = accounts[0];
  return {
    stripeEnabled: row.stripeEnabled,
    stripeMode: row.stripeMode === "live" ? "live" : "test",
    publishableKey: row.stripePublishableKey ?? "",
    secretSet: Boolean(row.stripeSecretCiphertext),
    webhookSet: Boolean(row.stripeWebhookCiphertext),
    cardTopupEnabled: row.cardTopupEnabled,
    minTopupFen: row.minTopupFen,
    maxTopupFen: row.maxTopupFen,
    dailyTopupFen: row.dailyTopupFen,
    bankEnabled: row.bankEnabled,
    bankAccounts: accounts,
    bankName: first?.bankName ?? "",
    accountHolder: first?.accountHolder ?? "",
    accountNumber: first?.accountNumber ?? "",
    swift: first?.swift ?? "",
    bankCountry: first?.country ?? "",
    bankCurrency: first?.currency || "USD",
    bankInstructions: first?.instructions ?? "",
    status: {
      stripe: stripeReady ? "Connected" : "Not configured",
      bank: bankReady ? (accounts.length === 1 ? "Enabled" : `${accounts.length} accounts`) : "Disabled",
      cardTopup: row.cardTopupEnabled ? "Enabled" : "Disabled",
    },
  };
}

export async function savePaymentSettings(
  db: Database,
  env: PayEnv,
  input: {
    stripeEnabled: boolean;
    stripeMode: "test" | "live";
    publishableKey: string;
    secretKey: string;
    webhookSecret: string;
    cardTopupEnabled: boolean;
    minTopupFen: number;
    maxTopupFen: number;
    dailyTopupFen: number;
    bankEnabled: boolean;
    bankAccounts: BankAccountInput[];
  },
) {
  if (input.minTopupFen < 100 || input.maxTopupFen < input.minTopupFen || input.dailyTopupFen < input.maxTopupFen) {
    throw new AppError("VALIDATION_ERROR", "Check the top-up limits. Daily limit must cover the maximum.");
  }
  if (input.bankAccounts.length > 10) throw new AppError("VALIDATION_ERROR", "You can save up to 10 bank accounts.");
  const accounts = input.bankAccounts
    .map((account) => ({
      id: account.id.trim() || crypto.randomUUID(),
      label: account.label.trim(),
      bankName: account.bankName.trim(),
      accountHolder: account.accountHolder.trim(),
      accountNumber: account.accountNumber.trim(),
      swift: account.swift.trim(),
      country: account.country.trim(),
      currency: (account.currency.trim() || "USD").toUpperCase(),
      instructions: account.instructions.trim(),
    }))
    .filter((account) => account.label || account.bankName || account.accountHolder || account.accountNumber || account.swift || account.country || account.instructions);
  if (accounts.some((account) => !account.bankName || !account.accountHolder || !account.accountNumber)) {
    throw new AppError("VALIDATION_ERROR", "Each bank account needs a bank name, account holder, and account number.");
  }
  if (input.bankEnabled && accounts.length === 0) throw new AppError("VALIDATION_ERROR", "Add a bank account before enabling bank transfer.");
  const current = await settingsRow(db);
  const secret = input.secretKey.trim() ? input.secretKey.trim() : current.stripeSecretCiphertext ? await decryptSecret(authSecret(env), current.stripeSecretCiphertext).catch(() => "") : "";
  const publishable = input.publishableKey.trim();
  const problem = stripeKeyModeProblem(input.stripeMode, secret, publishable);
  if (problem) throw new AppError("VALIDATION_ERROR", problem);
  const values = {
    stripeEnabled: input.stripeEnabled,
    stripeMode: input.stripeMode,
    stripePublishableKey: publishable || null,
    stripeSecretCiphertext: input.secretKey.trim() ? await encryptSecret(authSecret(env), input.secretKey.trim()) : current.stripeSecretCiphertext,
    stripeWebhookCiphertext: input.webhookSecret.trim() ? await encryptSecret(authSecret(env), input.webhookSecret.trim()) : current.stripeWebhookCiphertext,
    cardTopupEnabled: input.cardTopupEnabled,
    minTopupFen: input.minTopupFen,
    maxTopupFen: input.maxTopupFen,
    dailyTopupFen: input.dailyTopupFen,
    bankEnabled: input.bankEnabled,
    bankName: accounts[0]?.bankName ?? null,
    accountHolder: accounts[0]?.accountHolder ?? null,
    accountNumber: accounts[0]?.accountNumber ?? null,
    swift: accounts[0]?.swift ?? null,
    bankCountry: accounts[0]?.country ?? null,
    bankCurrency: accounts[0]?.currency || "USD",
    bankInstructions: accounts[0]?.instructions ?? null,
    updatedAt: Date.now(),
  };
  await db.update(paymentSettings).set(values).where(eq(paymentSettings.id, SINGLETON_ID));
  await db.delete(bankAccounts);
  const now = Date.now();
  if (accounts.length) {
    await db.insert(bankAccounts).values(
      accounts.map((account, index) => ({
        id: account.id,
        label: account.label || null,
        bankName: account.bankName,
        accountHolder: account.accountHolder,
        accountNumber: account.accountNumber,
        swift: account.swift || null,
        country: account.country || null,
        currency: account.currency.slice(0, 8) || "USD",
        instructions: account.instructions || null,
        sortOrder: index,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }
  return publicPaymentSettings(db);
}

export async function testStripe(db: Database, env: PayEnv) {
  const stripe = await stripeClient(db, env);
  const balance = await stripe.balance.retrieve();
  return { ok: true as const, mode: balance.livemode ? "live" : "test" };
}

export async function createShipmentCheckoutSession(db: Database, env: PayEnv, userId: string, checkoutId: string, origin: string) {
  const stripe = await stripeClient(db, env);
  const checkout = (await db.select().from(checkouts).where(and(eq(checkouts.id, checkoutId), eq(checkouts.userId, userId))))[0];
  if (!checkout || checkout.status !== "READY") throw new AppError("CHECKOUT_CLOSED", "This checkout is no longer payable.");
  const existing = (await db.select().from(payments).where(and(eq(payments.checkoutId, checkoutId), eq(payments.status, "paid"))))[0];
  if (existing) throw new AppError("CHECKOUT_CLOSED", "This shipment is already paid.");
  const currency = await customerCurrency(db);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${origin}/app/checkout/${checkoutId}/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/checkout/${checkoutId}`,
    client_reference_id: checkoutId,
    line_items: [{ quantity: 1, price_data: { currency: currency.toLowerCase(), unit_amount: checkout.totalFen, product_data: { name: "Freight payment" } } }],
    metadata: { purpose: "shipment", checkoutId, userId, amountFen: String(checkout.totalFen) },
  });
  await db.insert(payments).values({
    id: crypto.randomUUID(),
    userId,
    purpose: "shipment",
    method: "stripe",
    amountFen: checkout.totalFen,
    currency,
    status: "pending",
    checkoutId,
    shipmentId: null,
    stripeSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    hiobuyStatus: "pending",
    hiobuyError: null,
    riskStatus: null,
    idempotencyKey: null,
    createdAt: Date.now(),
    paidAt: null,
  });
  return { url: session.url };
}

export async function createTopupCheckoutSession(db: Database, env: PayEnv, userId: string, amountFen: number, origin: string) {
  const settings = await settingsRow(db);
  if (!settings.cardTopupEnabled) throw new AppError("VALIDATION_ERROR", "Card top-up is turned off.");
  if (amountFen < settings.minTopupFen || amountFen > settings.maxTopupFen) {
    throw new AppError("VALIDATION_ERROR", "That amount is outside the allowed top-up range.");
  }
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await db.select().from(payments).where(and(eq(payments.userId, userId), eq(payments.purpose, "topup"), eq(payments.method, "stripe"), gte(payments.createdAt, since)));
  const used = recent.filter((row) => row.status === "paid" || row.status === "held").reduce((sum, row) => sum + row.amountFen, 0);
  if (used + amountFen > settings.dailyTopupFen) throw new AppError("VALIDATION_ERROR", "This top-up would pass the daily card limit.");
  const stripe = await stripeClient(db, env);
  const currency = await customerCurrency(db);
  const held = amountFen >= settings.maxTopupFen;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${origin}/app/wallet?topup=pending`,
    cancel_url: `${origin}/app/wallet/top-up`,
    line_items: [{ quantity: 1, price_data: { currency: currency.toLowerCase(), unit_amount: amountFen, product_data: { name: "Wallet top-up" } } }],
    metadata: { purpose: "topup", userId, amountFen: String(amountFen), held: held ? "1" : "0" },
  });
  await db.insert(payments).values({
    id: crypto.randomUUID(),
    userId,
    purpose: "topup",
    method: "stripe",
    amountFen,
    currency,
    status: "pending",
    checkoutId: null,
    shipmentId: null,
    stripeSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    hiobuyStatus: "skipped",
    hiobuyError: null,
    riskStatus: held ? "held" : null,
    idempotencyKey: null,
    createdAt: Date.now(),
    paidAt: null,
  });
  return { url: session.url };
}

export async function handleStripeWebhook(db: Database, env: PayEnv, raw: string, signature: string | undefined) {
  const settings = await settingsRow(db);
  if (!settings.stripeWebhookCiphertext || !signature) throw new AppError("VALIDATION_ERROR", "Webhook is not configured.", 400);
  const secret = await decryptSecret(authSecret(env), settings.stripeWebhookCiphertext);
  const stripe = await stripeClient(db, env);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Webhook signature was rejected.", 400);
  }
  const seen = (await db.select().from(paymentEvents).where(eq(paymentEvents.id, event.id)))[0];
  if (seen?.status === "processed") return { ok: true as const, duplicate: true };
  if (!seen) {
    try {
      await db.insert(paymentEvents).values({ id: event.id, type: event.type, status: "processing", error: null, createdAt: Date.now() });
    } catch {
      const again = (await db.select().from(paymentEvents).where(eq(paymentEvents.id, event.id)))[0];
      if (again?.status === "processed") return { ok: true as const, duplicate: true };
    }
  }
  try {
    await applyStripeEvent(db, event);
    await db.update(paymentEvents).set({ status: "processed", error: null }).where(eq(paymentEvents.id, event.id));
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Webhook failed.").slice(0, 300);
    await db.update(paymentEvents).set({ status: "failed", error: message }).where(eq(paymentEvents.id, event.id));
    throw error;
  }
  return { ok: true as const, duplicate: false };
}

const PROOF_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const PROOF_MAX_BYTES = 5 * 1024 * 1024;

export async function createBankTransfer(
  db: Database,
  bucket: R2Bucket | undefined,
  userId: string,
  input: { amountFen: number; reference: string; transferDate: string; proofNote: string; bankAccountId: string },
  proof: File | null,
) {
  const settings = await settingsRow(db);
  if (!settings.bankEnabled) throw new AppError("VALIDATION_ERROR", "Bank transfer is not available.");
  const accounts = await listBankAccounts(db);
  const chosen = accounts.find((account) => account.id === input.bankAccountId) ?? (accounts.length === 1 ? accounts[0] : undefined);
  if (!chosen) throw new AppError("VALIDATION_ERROR", "Choose the bank account you paid.");
  if (input.amountFen < settings.minTopupFen || input.amountFen > settings.maxTopupFen) throw new AppError("VALIDATION_ERROR", "That amount is outside the allowed top-up range.");
  if (!input.reference.trim()) throw new AppError("VALIDATION_ERROR", "Enter the account you paid from.");
  const ext = proof ? PROOF_TYPES.get(proof.type) : undefined;
  if (!proof || !ext || proof.size <= 0) throw new AppError("VALIDATION_ERROR", "Upload a JPEG, PNG, or WebP screenshot of the transfer.");
  if (proof.size > PROOF_MAX_BYTES) throw new AppError("VALIDATION_ERROR", "The screenshot must be under 5 MB.");
  if (!bucket) throw new AppError("CONFIG", "Photo storage is not configured.", 500);
  const id = crypto.randomUUID();
  const publicId = `BT-${Date.now().toString(36).toUpperCase()}`;
  const objectKey = `transfers/${id}.${ext}`;
  const currency = await customerCurrency(db);
  await bucket.put(objectKey, await proof.arrayBuffer(), { httpMetadata: { contentType: proof.type } });
  await db.insert(bankTransfers).values({
    id,
    publicId,
    userId,
    amountFen: input.amountFen,
    currency,
    reference: input.reference.trim() || null,
    transferDate: input.transferDate.trim() || null,
    proofNote: input.proofNote.trim().slice(0, 500) || null,
    proofObjectKey: objectKey,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    bankAccountId: chosen.id,
    bankAccountLabel: chosen.label || chosen.bankName,
    createdAt: Date.now(),
  });
  await notify(db, userId, { type: "BANK_SUBMITTED", title: "Bank transfer submitted", body: `${publicId} is waiting for the operator to confirm the deposit.`, href: "/app/wallet" });
  return { id, publicId, status: "pending" as const };
}

export async function readTransferProof(db: Database, bucket: R2Bucket | undefined, id: string, viewer: { id: string; isAdmin: boolean }) {
  const row = (await db.select().from(bankTransfers).where(eq(bankTransfers.id, id)))[0];
  if (!row?.proofObjectKey || !bucket) throw new AppError("NOT_FOUND", "Screenshot not found.", 404);
  if (!viewer.isAdmin && row.userId !== viewer.id) throw new AppError("NOT_FOUND", "Screenshot not found.", 404);
  const object = await bucket.get(row.proofObjectKey);
  if (!object) throw new AppError("NOT_FOUND", "Screenshot not found.", 404);
  return object;
}

export async function listMyTransfers(db: Database, userId: string, status: string, page: number, pageSize: number) {
  const rows = await db.select().from(bankTransfers).where(eq(bankTransfers.userId, userId)).orderBy(desc(bankTransfers.createdAt));
  const counts = {
    pending: rows.filter((row) => row.status === "pending").length,
    approved: rows.filter((row) => row.status === "approved").length,
    rejected: rows.filter((row) => row.status === "rejected").length,
  };
  const wanted = status === "pending" || status === "approved" || status === "rejected" ? status : "";
  const filtered = wanted ? rows.filter((row) => row.status === wanted) : rows;
  const start = (Math.max(1, page) - 1) * pageSize;
  return {
    counts,
    items: filtered.slice(start, start + pageSize).map(presentTransfer),
    page: Math.max(1, page),
    pageSize,
    total: filtered.length,
  };
}

export async function reviewBankTransfer(db: Database, adminEmail: string, id: string, decision: "approve" | "reject", note: string) {
  const row = (await db.select().from(bankTransfers).where(eq(bankTransfers.id, id)))[0];
  if (!row) throw new AppError("NOT_FOUND", "That top-up request was not found.", 404);
  const now = Date.now();
  const updated = await db
    .update(bankTransfers)
    .set({ status: decision === "approve" ? "approved" : "rejected", reviewedBy: adminEmail, reviewedAt: now, reviewNote: note.slice(0, 240) || null })
    .where(and(eq(bankTransfers.id, id), eq(bankTransfers.status, "pending")))
    .returning({ id: bankTransfers.id });
  if (!updated.length) throw new AppError("INVALID_STATE", "This request was already reviewed.", 409);
  if (decision === "reject") {
    await notify(db, row.userId, { type: "BANK_REJECTED", title: "Bank transfer was not confirmed", body: `${row.publicId} was not added to your wallet.`, href: "/app/wallet" });
    return { ok: true as const };
  }
  try {
    await moveWallet(db, { userId: row.userId, amountFen: row.amountFen, type: "TOP_UP", referenceType: "BANK_TRANSFER", referenceId: row.id, description: `Bank transfer ${row.publicId}` });
  } catch (error) {
    await db.update(bankTransfers).set({ status: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null }).where(eq(bankTransfers.id, id));
    throw error;
  }
  const paymentId = crypto.randomUUID();
  await db.insert(payments).values({
    id: paymentId,
    userId: row.userId,
    purpose: "topup",
    method: "bank",
    amountFen: row.amountFen,
    currency: row.currency,
    status: "paid",
    checkoutId: null,
    shipmentId: null,
    stripeSessionId: null,
    stripePaymentIntentId: null,
    hiobuyStatus: "skipped",
    hiobuyError: null,
    riskStatus: null,
    idempotencyKey: `bank:${row.id}`,
    createdAt: now,
    paidAt: now,
  });
  const { safeIssueWalletReceipt } = await import("./invoicing");
  await safeIssueWalletReceipt(db, row.userId, "BANK_TRANSFER", row.id);
  await notify(db, row.userId, { type: "BANK_APPROVED", title: "Bank transfer approved", body: `${row.publicId} was added to your wallet.`, href: "/app/wallet" });
  return { ok: true as const };
}

export async function listAdminPayments(db: Database, query: { status?: string; q?: string; from?: string; to?: string; page: number }) {
  const page = Math.max(1, query.page);
  const from = query.from ? Date.parse(query.from) : NaN;
  const to = query.to ? Date.parse(query.to) + 86_400_000 : NaN;
  const rows = await db.select().from(payments).orderBy(desc(payments.createdAt)).limit(500);
  const filtered = rows.filter((row) => {
    if (query.status && row.status !== query.status) return false;
    if (Number.isFinite(from) && row.createdAt < from) return false;
    if (Number.isFinite(to) && row.createdAt >= to) return false;
    if (query.q && !`${row.id} ${row.userId} ${row.checkoutId ?? ""} ${row.shipmentId ?? ""}`.toLowerCase().includes(query.q.toLowerCase())) return false;
    return true;
  });
  const slice = filtered.slice((page - 1) * 20, page * 20);
  const users = slice.length ? await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(inArray(user.id, [...new Set(slice.map((row) => row.userId))])) : [];
  const names = new Map(users.map((item) => [item.id, item]));
  return {
    page,
    total: filtered.length,
    items: slice.map((row) => ({
      id: row.id,
      customer: names.get(row.userId)?.name ?? row.userId,
      email: names.get(row.userId)?.email ?? "",
      method: row.method,
      purpose: row.purpose,
      amountFen: row.amountFen,
      status: row.status,
      hiobuyStatus: row.hiobuyStatus,
      riskStatus: row.riskStatus,
      failureReason: row.hiobuyError,
      checkoutId: row.checkoutId,
      shipmentId: row.shipmentId,
      createdAt: new Date(row.createdAt).toISOString(),
    })),
  };
}

/** Pending requests stay first so a rejection remains on the same list both sides can match. */
export async function listPendingTopups(db: Database) {
  const rows = await db.select().from(bankTransfers).orderBy(desc(bankTransfers.createdAt)).limit(100);
  const owners = rows.length
    ? await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(inArray(user.id, [...new Set(rows.map((row) => row.userId))]))
    : [];
  const names = new Map(owners.map((item) => [item.id, item]));
  const rank: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
  return rows
    .map((row) => ({ ...presentTransfer(row), customer: names.get(row.userId)?.name ?? "Customer", email: names.get(row.userId)?.email ?? "" }))
    .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || b.createdAt.localeCompare(a.createdAt));
}

export async function listRefunds(db: Database) {
  const rows = await db.select().from(refundRecords).orderBy(desc(refundRecords.createdAt)).limit(50);
  const disputes = await db.select().from(payments).where(inArray(payments.status, ["disputed", "held"])).orderBy(desc(payments.createdAt)).limit(50);
  return {
    refunds: rows.map((row) => ({ id: row.id, paymentId: row.paymentId, amountFen: row.amountFen, method: row.method, status: row.status, note: row.note, createdAt: new Date(row.createdAt).toISOString() })),
    disputes: disputes.map((row) => ({ id: row.id, userId: row.userId, amountFen: row.amountFen, status: row.status, riskStatus: row.riskStatus, method: row.method })),
  };
}

export async function refundPayment(db: Database, env: PayEnv, paymentId: string, amountFen: number, note: string) {
  const payment = (await db.select().from(payments).where(eq(payments.id, paymentId)))[0];
  if (!payment || (payment.status !== "paid" && payment.status !== "disputed")) throw new AppError("INVALID_STATE", "This payment cannot be refunded.", 409);
  if (amountFen < 1 || amountFen > payment.amountFen) throw new AppError("VALIDATION_ERROR", "Refund amount is outside the original payment.");
  const prior = await db.select().from(refundRecords).where(and(eq(refundRecords.paymentId, paymentId), eq(refundRecords.status, "refunded")));
  const already = prior.reduce((sum, row) => sum + row.amountFen, 0);
  if (already + amountFen > payment.amountFen) throw new AppError("INVALID_STATE", "That refund would exceed the original payment.", 409);
  const refundId = crypto.randomUUID();
  if (payment.method === "stripe") {
    if (!payment.stripePaymentIntentId) throw new AppError("INVALID_STATE", "This card payment has no Stripe charge to refund.", 409);
    if (payment.purpose === "topup") await moveWallet(db, { userId: payment.userId, amountFen: -amountFen, type: "ADJUSTMENT", referenceType: "REFUND", referenceId: `${paymentId}:${already}`, description: note || "Card top-up refund", insufficientMessage: "The wallet does not have enough available balance for this reversal." });
    try {
      const stripe = await stripeClient(db, env);
      const refund = await stripe.refunds.create({ payment_intent: payment.stripePaymentIntentId, amount: amountFen });
      await db.insert(refundRecords).values({ id: refundId, paymentId, amountFen, method: "stripe", status: "refunded", stripeRefundId: refund.id, note, createdAt: Date.now() });
    } catch (error) {
      if (payment.purpose === "topup") await moveWallet(db, { userId: payment.userId, amountFen, type: "ADJUSTMENT", referenceType: "REFUND_REVERSAL", referenceId: `${paymentId}:${already}`, description: "Card refund did not complete" });
      throw error;
    }
  } else if (payment.method === "wallet") {
    await moveWallet(db, { userId: payment.userId, amountFen, type: "REFUND", referenceType: "REFUND", referenceId: `${paymentId}:${already}`, description: note || "Refund" });
    await db.insert(refundRecords).values({ id: refundId, paymentId, amountFen, method: "wallet", status: "refunded", stripeRefundId: null, note, createdAt: Date.now() });
  } else {
    if (payment.purpose === "topup") await moveWallet(db, { userId: payment.userId, amountFen: -amountFen, type: "ADJUSTMENT", referenceType: "BANK_REFUND", referenceId: `${paymentId}:${already}`, description: note || "Bank refund", insufficientMessage: "The wallet does not have enough available balance for this reversal." });
    await db.insert(refundRecords).values({ id: refundId, paymentId, amountFen, method: "bank", status: "refunded", stripeRefundId: null, note: note || "Manual bank refund recorded", createdAt: Date.now() });
  }
  if (already + amountFen === payment.amountFen) await db.update(payments).set({ status: "refunded" }).where(eq(payments.id, paymentId));
  const { safeIssueRefundCredit } = await import("./invoicing");
  await safeIssueRefundCredit(db, refundId);
  await notify(db, payment.userId, { type: "REFUND_COMPLETED", title: "Refund completed", body: note || "A refund was completed.", href: "/app/wallet" });
  return { ok: true as const };
}

export async function stripeSessionStatus(db: Database, userId: string, sessionId: string) {
  const row = (await db.select().from(payments).where(and(eq(payments.stripeSessionId, sessionId), eq(payments.userId, userId))))[0];
  return { status: row?.status ?? "pending", purpose: row?.purpose ?? null };
}

export async function retryHiobuyPayment(db: Database, paymentId: string) {
  const { requeueHiobuyPayment } = await import("./fulfillment-sync");
  return requeueHiobuyPayment(db, paymentId);
}

export async function recordWalletShipmentPayment(db: Database, userId: string, checkoutId: string, amountFen: number) {
  const existing = (await db.select().from(payments).where(and(eq(payments.checkoutId, checkoutId), eq(payments.status, "paid"))))[0];
  if (existing) return;
  const currency = await customerCurrency(db);
  await db.insert(payments).values({
    id: crypto.randomUUID(),
    userId,
    purpose: "shipment",
    method: "wallet",
    amountFen,
    currency,
    status: "paid",
    checkoutId,
    shipmentId: null,
    stripeSessionId: null,
    stripePaymentIntentId: null,
    hiobuyStatus: "pending",
    hiobuyError: null,
    riskStatus: null,
    idempotencyKey: `wallet:${checkoutId}`,
    createdAt: Date.now(),
    paidAt: Date.now(),
  });
  await notify(db, userId, { type: "SHIPPING_PAID", title: "Freight paid", body: "Your wallet paid the freight. HioBuy fulfillment payment is still pending.", href: "/app/shipments" });
}

async function applyStripeEvent(db: Database, event: Stripe.Event) {
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== "paid") return;
    await confirmCheckoutSession(db, session);
    return;
  }
  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    await db.update(payments).set({ status: "failed" }).where(eq(payments.stripeSessionId, session.id));
    return;
  }
  if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
    const dispute = event.data.object as Stripe.Dispute;
    const intent = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!intent) return;
    const payment = (await db.select().from(payments).where(eq(payments.stripePaymentIntentId, intent)))[0];
    if (!payment) throw new AppError("NOT_FOUND", "The disputed payment is not linked yet.", 409);
    if (event.type === "charge.dispute.created") {
      await db.update(payments).set({ status: "disputed", riskStatus: "review" }).where(and(eq(payments.id, payment.id), sql`${payments.status} != 'disputed'`));
      return;
    }
    const won = dispute.status === "won";
    if (!won && payment.purpose === "topup") {
      try {
        await moveWallet(db, { userId: payment.userId, amountFen: -payment.amountFen, type: "ADJUSTMENT", referenceType: "DISPUTE", referenceId: payment.id, description: "Card dispute lost", insufficientMessage: "The wallet does not have enough available balance for this reversal." });
      } catch {
        await db.update(payments).set({ status: "disputed", riskStatus: "shortfall" }).where(eq(payments.id, payment.id));
        return;
      }
    }
    await db.update(payments).set({ status: won ? "paid" : "refunded", riskStatus: won ? null : "lost" }).where(eq(payments.id, payment.id));
  }
}

async function confirmCheckoutSession(db: Database, session: Stripe.Checkout.Session) {
  const purpose = session.metadata?.purpose;
  const userId = session.metadata?.userId;
  const amountFen = Number(session.metadata?.amountFen);
  if (!userId || !Number.isInteger(amountFen)) return;
  const payment = (await db.select().from(payments).where(eq(payments.stripeSessionId, session.id)))[0];
  if (!payment || payment.status === "paid" || payment.status === "held" || payment.status === "disputed" || payment.status === "refunded") return;
  if (payment.amountFen !== amountFen) {
    await db.update(payments).set({ status: "failed", hiobuyError: "Paid amount did not match the server amount." }).where(eq(payments.id, payment.id));
    await notify(db, userId, { type: "PAYMENT_FAILED", title: "Payment needs review", body: "The paid amount did not match the bill, so it was not applied.", href: "/app/wallet" });
    return;
  }
  const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (purpose === "topup") {
    if (session.metadata?.held === "1") {
      await db.update(payments).set({ status: "held", stripePaymentIntentId: intent, riskStatus: "held" }).where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
      return;
    }
    const claimed = await db.update(payments).set({ status: "paid", paidAt: Date.now(), stripePaymentIntentId: intent }).where(and(eq(payments.id, payment.id), eq(payments.status, "pending"))).returning({ id: payments.id });
    if (!claimed.length) return;
    await moveWallet(db, { userId, amountFen, type: "TOP_UP", referenceType: "STRIPE", referenceId: payment.id, description: "Card top-up" });
    const { safeIssueWalletReceipt } = await import("./invoicing");
    await safeIssueWalletReceipt(db, userId, "STRIPE", payment.id);
    await notify(db, userId, { type: "TOPUP_SUCCESS", title: "Wallet topped up", body: "Your card top-up was added to the wallet.", href: "/app/wallet" });
    return;
  }
  if (purpose !== "shipment" || !payment.checkoutId) return;
  const checkout = (await db.select().from(checkouts).where(eq(checkouts.id, payment.checkoutId)))[0];
  if (!checkout || checkout.totalFen !== amountFen) {
    await db.update(payments).set({ status: "failed", hiobuyError: "Checkout amount changed before the card payment was confirmed." }).where(eq(payments.id, payment.id));
    return;
  }
  if (checkout.status === "PAID") {
    await db.update(payments).set({ status: "failed", hiobuyError: "The shipment was already paid, so this card payment was not applied." }).where(eq(payments.id, payment.id));
    return;
  }
  const claimed = await db.update(payments).set({ status: "paid", paidAt: Date.now(), stripePaymentIntentId: intent, hiobuyStatus: "pending" }).where(and(eq(payments.id, payment.id), eq(payments.status, "pending"))).returning({ id: payments.id });
  if (!claimed.length) return;
  const { checkoutItems } = await import("./db/schema");
  const { fulfillmentConnected } = await import("./freight");
  const lines = await db.select().from(checkoutItems).where(eq(checkoutItems.checkoutId, checkout.id));
  const now = Date.now();
  const connected = await fulfillmentConnected(db);
  const shipmentIds = lines.map((line) => line.referenceId);
  await db.batch([
    db.update(checkouts).set({ status: "PAID", paidAt: now }).where(and(eq(checkouts.id, checkout.id), eq(checkouts.status, "READY"))),
    db.update(shipments).set({ status: "READY_TO_SHIP", upstreamStatus: connected ? "WAIT_PAYMENT" : "WAIT_SHIP", canCancel: false, updatedAt: now }).where(and(eq(shipments.userId, userId), inArray(shipments.id, shipmentIds), eq(shipments.status, "TO_PAY"))),
    db.update(charges).set({ status: "PAID" }).where(and(inArray(charges.shipmentId, shipmentIds), eq(charges.status, "DUE"))),
  ]);
  await notify(db, userId, { type: "SHIPPING_PAID", title: "Freight paid", body: "Your card paid the freight. HioBuy fulfillment payment is still pending.", href: "/app/shipments" });
  const { safeIssueCheckoutDocuments } = await import("./invoicing");
  await safeIssueCheckoutDocuments(db, checkout.id);
}

async function stripeClient(db: Database, env: PayEnv) {
  const settings = await settingsRow(db);
  if (!settings.stripeSecretCiphertext) throw new AppError("VALIDATION_ERROR", "Save a Stripe secret key first.");
  const secret = await decryptSecret(authSecret(env), settings.stripeSecretCiphertext);
  return new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });
}

function settingsRow(db: Database) {
  return singletonRow(db, paymentSettings);
}

function presentTransfer(row: typeof bankTransfers.$inferSelect) {
  return {
    id: row.id,
    publicId: row.publicId,
    userId: row.userId,
    amountFen: row.amountFen,
    currency: row.currency,
    reference: row.reference,
    transferDate: row.transferDate,
    proofNote: row.proofNote,
    hasProof: Boolean(row.proofObjectKey),
    status: row.status,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : null,
    reviewNote: row.reviewNote,
    bankAccountLabel: row.bankAccountLabel,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}
