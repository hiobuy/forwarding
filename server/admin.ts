import { and, desc, eq, gte, inArray, isNotNull, isNull, like, lte, or } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { ADMIN_SHIPMENT_FILTERS, CARGO_ATTRIBUTES, PACKAGE_FILTERS, PACKAGE_MORE_FILTERS, adminShipmentMatches, adminShipmentStatus, customerPaymentLabel, hiobuyPaymentLabel, type CustomerShipmentStatus } from "../src/domain/status";
import type { Database } from "./db/client";
import {
  assistantKnowledge,
  assistantUnanswered,
  bankTransfers,
  claims,
  packageExceptions,
  packagePhotos,
  packages,
  shipmentPackages,
  shipments,
  staffMembers,
  user,
  vasRequests,
  walletTransactions,
  wallets,
} from "./db/schema";
import { cancelShipment, loadPackageGraph, loadShipments, requestVas, resolveException, shipmentActivity } from "./data";
import { parsePercentBps, parseRateE4, yuanToFen } from "../src/domain/freight";
import { notify } from "./notify";
import { packageRow, shipmentRow } from "./rows";
import { dispatchShipment, owners, packShipment, receivePackage } from "./warehouse-ops";
import { connectHioBuy, resolveHioBuyToken, saveApiKey, saveAutoSyncPackages, savePricing, saveTrackingEventLabels, setAllCountries, setCountryEnabled, settingsView, syncFreightDestinations, syncWarehouseAddress, trackingEventLabelView, verifyHioBuyAccess } from "./freight";
import { earningViewsFor, earningsSummary, finalizeEarningCost, presentEarning, recordEarningAdjustment } from "./earnings";
import { calculatorOptions, channelDetail, estimateShipping, parseCalculatorInput } from "./calculator";
import { allowQuoteAttempt } from "./quote-limit";
import { hioBuyBalanceView, hioBuyTransactionView, hioBuyTransactionsView } from "./hiobuy-ledger";
import { emailAdmin } from "./email/http";
import { listAdminPayments, listPendingTopups, listRefunds, publicPaymentSettings, readTransferProof, refundPayment, retryHiobuyPayment, reviewBankTransfer, savePaymentSettings, testStripe } from "./payments";
import { vasCatalog } from "../src/mocks/vas";
import { AppError } from "./errors";
import { moveWallet } from "./wallet";
import { adminPath, can, permissionFor } from "../src/domain/staff";
import { authorizeStaff, changeStaffRole, inviteStaff, noteSecurityEvent, recordAudit, removeStaff, revokeInvite, setStaffStatus, staffMe, teamSnapshot, type StaffActor } from "./staff";

/**
 * Merchant back office.
 * Mounted under /api/admin after the normal session check. Active staff only.
 * ADMIN_EMAILS is read once, to create the first owners. Warehouse floor work stays with HioBuy.
 */

type AdminEnv = {
  Bindings: {
    ADMIN_EMAILS?: string;
    ENVIRONMENT?: string;
    PHOTOS?: R2Bucket;
    HIOBUY_API_TOKEN?: string;
    BETTER_AUTH_SECRET?: string;
    APP_URL?: string;
    TRUSTED_APP_ORIGINS?: string;
    BUSINESS_NAME?: string;
    BUSINESS_EMAIL?: string;
    PUBLIC_WEBSITE_URL?: string;
  };
  Variables: { requestId: string; db: Database; user: { id: string; name: string; email: string }; staff: StaffActor; auth: unknown };
};

function ok<T>(c: { json: (body: unknown) => Response; get: (key: "requestId") => string }, data: T) {
  return c.json({ data, requestId: c.get("requestId") });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("VALIDATION_ERROR", result.error.issues[0]?.message ?? "Invalid request.");
  return result.data;
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pageSize, total: items.length };
}

function matches(text: string, q: string) {
  return !q || text.toLowerCase().includes(q.toLowerCase());
}

function dayBound(raw: string | undefined, end: boolean) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const start = Date.parse(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(start)) return null;
  return end ? start + 86_400_000 - 1 : start;
}

function countsFor<T>(items: T[], filters: readonly { key: string }[], match: (item: T, key: string) => boolean) {
  return Object.fromEntries(filters.map((filter) => [filter.key, filter.key === "all" ? items.length : items.filter((item) => match(item, filter.key)).length]));
}

const PACKAGE_ADMIN_FILTERS = [...PACKAGE_FILTERS.filter((item) => item.key !== "exception"), ...PACKAGE_MORE_FILTERS] as const;

function fulfillmentOf(item: { hiobuyShipmentId: string | null; upstreamStatus?: string | null; hiobuyStatus: string | null; status: CustomerShipmentStatus }) {
  return adminShipmentStatus({ hiobuyShipmentId: item.hiobuyShipmentId, upstreamStatus: item.hiobuyStatus ?? item.upstreamStatus ?? null, localStatus: item.status });
}

function canPayHioBuy(item: { status: string; hiobuyShipmentId: string | null; hiobuyStatus: string | null; hiobuyPaymentStatus: string | null }) {
  const customerPaid = item.status === "READY_TO_SHIP" || item.status === "SHIPPED" || item.status === "IN_TRANSIT" || item.status === "DELIVERED";
  return Boolean(item.hiobuyShipmentId) && customerPaid && item.hiobuyStatus === "WAIT_PAYMENT" && item.hiobuyPaymentStatus !== "PAID" && item.hiobuyPaymentStatus !== "PARTIAL";
}

export const admin = new Hono<AdminEnv>();

admin.use("*", async (c, next) => {
  const actor = await authorizeStaff(c.get("db"), c.get("user"), c.env.ADMIN_EMAILS);
  const permission = permissionFor(c.req.method, adminPath(c.req.path));
  if (permission === "deny" || (permission !== "staff" && !can(actor.role, permission))) {
    throw new AppError("FORBIDDEN", "You don't have permission for this.", 403);
  }
  c.set("staff", actor);
  await next();
});

const staffRole = z.enum(["owner", "manager", "support"]);

admin.get("/me", async (c) => {
  const actor = c.get("staff");
  const account = (await c.get("db").select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, actor.id)))[0];
  const { hiobuyPay2faRequired } = await import("./platform");
  return ok(c, { ...staffMe(actor, Boolean(account?.twoFactorEnabled)), name: c.get("user").name, hiobuyPay2fa: await hiobuyPay2faRequired(c.get("db")) });
});

admin.get("/team", async (c) => ok(c, await teamSnapshot(c.get("db"))));

admin.post("/team/invites", async (c) => {
  const body = parse(z.object({ email: z.string().trim().email().max(200), role: staffRole }), await c.req.json());
  const origin = new URL(c.req.url).origin;
  return ok(c, await inviteStaff(c.get("db"), c.get("staff"), body, origin, c.env.ENVIRONMENT !== "production"));
});

admin.delete("/team/invites/:id", async (c) => ok(c, await revokeInvite(c.get("db"), c.get("staff"), c.req.param("id"))));

admin.patch("/team/:userId", async (c) => {
  const body = parse(z.object({ role: staffRole }), await c.req.json());
  return ok(c, await changeStaffRole(c.get("db"), c.get("staff"), c.req.param("userId"), body.role));
});

admin.post("/team/:userId/disable", async (c) => ok(c, await setStaffStatus(c.get("db"), c.get("staff"), c.req.param("userId"), "disabled")));
admin.post("/team/:userId/enable", async (c) => ok(c, await setStaffStatus(c.get("db"), c.get("staff"), c.req.param("userId"), "active")));
admin.delete("/team/:userId", async (c) => ok(c, await removeStaff(c.get("db"), c.get("staff"), c.req.param("userId"))));

admin.post("/team/:userId/reset-2fa", async (c) => {
  if (c.req.param("userId") === c.get("staff").id) throw new AppError("FORBIDDEN", "Ask another owner to reset your authenticator.", 403);
  const { resetStaffFactor } = await import("./pay-factor");
  await resetStaffFactor(c.get("db"), c.req.param("userId"));
  await recordAudit(c.get("db"), c.get("user"), "staff.2fa.reset", c.req.param("userId"), {});
  return ok(c, { ok: true });
});

admin.post("/team/security", async (c) => {
  const body = parse(z.object({ event: z.enum(["mfa.enabled", "mfa.disabled"]) }), await c.req.json());
  const account = (await c.get("db").select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, c.get("staff").id)))[0];
  return ok(c, await noteSecurityEvent(c.get("db"), c.get("staff"), body.event, Boolean(account?.twoFactorEnabled)));
});

admin.get("/settings/advanced", async (c) => {
  const { advancedSettings } = await import("./advanced");
  return ok(c, await advancedSettings(c.get("db"), c.env, new URL(c.req.url).origin));
});
admin.put("/settings/advanced/numbering", async (c) => {
  const { saveAdvancedNumbering } = await import("./advanced");
  const saved = await saveAdvancedNumbering(c.get("db"), await c.req.json());
  await recordAudit(c.get("db"), c.get("user"), "settings.numbering", "numbering", { adjusted: saved.adjusted });
  return ok(c, saved);
});
admin.put("/settings/advanced/google", async (c) => {
  const body = parse(z.object({ enabled: z.boolean(), clientId: z.string().max(200).optional().default(""), clientSecret: z.string().max(400).optional().default("") }), await c.req.json());
  const { saveAdvancedGoogle } = await import("./advanced");
  await saveAdvancedGoogle(c.get("db"), c.env, c.get("user").id, body);
  await recordAudit(c.get("db"), c.get("user"), "secrets.google", "google", { enabled: body.enabled });
  return ok(c, await (await import("./advanced")).advancedSettings(c.get("db"), c.env, new URL(c.req.url).origin));
});
admin.post("/settings/advanced/google/check", async (c) => {
  const { checkGoogle } = await import("./platform");
  return ok(c, await checkGoogle(c.get("db"), c.env, new URL(c.req.url).origin));
});
admin.put("/settings/advanced/turnstile", async (c) => {
  const body = parse(z.object({ enabled: z.boolean(), siteKey: z.string().max(200).optional().default(""), secret: z.string().max(400).optional().default(""), login: z.boolean(), register: z.boolean(), reset: z.boolean() }), await c.req.json());
  const { saveTurnstileSettings } = await import("./platform");
  await saveTurnstileSettings(c.get("db"), c.env, c.get("user").id, body);
  await recordAudit(c.get("db"), c.get("user"), "secrets.turnstile", "turnstile", { enabled: body.enabled });
  return ok(c, await (await import("./advanced")).advancedSettings(c.get("db"), c.env, new URL(c.req.url).origin));
});
admin.post("/settings/advanced/turnstile/check", async (c) => {
  const { checkTurnstile } = await import("./platform");
  return ok(c, await checkTurnstile(c.get("db"), c.env));
});
admin.put("/settings/advanced/features", async (c) => {
  const body = parse(z.object({ customerAi: z.boolean(), hiobuyPay2fa: z.boolean() }), await c.req.json());
  const { saveFeatureSettings } = await import("./platform");
  await saveFeatureSettings(c.get("db"), c.env, c.get("user").id, body);
  await recordAudit(c.get("db"), c.get("user"), "settings.features", "features", body);
  return ok(c, await (await import("./advanced")).advancedSettings(c.get("db"), c.env, new URL(c.req.url).origin));
});
admin.route("/email", emailAdmin);
admin.get("/payments/settings", async (c) => ok(c, await publicPaymentSettings(c.get("db"))));
admin.put("/payments/settings", async (c) => {
  const body = parse(
    z.object({
      stripeEnabled: z.boolean(),
      stripeMode: z.enum(["test", "live"]),
      publishableKey: z.string().max(200),
      secretKey: z.string().max(400).optional().default(""),
      webhookSecret: z.string().max(400).optional().default(""),
      cardTopupEnabled: z.boolean(),
      minTopupFen: z.number().int(),
      maxTopupFen: z.number().int(),
      dailyTopupFen: z.number().int(),
      bankEnabled: z.boolean(),
      bankName: z.string().max(120),
      accountHolder: z.string().max(120),
      accountNumber: z.string().max(80),
      swift: z.string().max(40),
      bankCountry: z.string().max(80),
      bankCurrency: z.string().max(8),
      bankInstructions: z.string().max(1000),
    }),
    await c.req.json(),
  );
  const saved = await savePaymentSettings(c.get("db"), c.env, body);
  await recordAudit(c.get("db"), c.get("user"), "secrets.stripe", "payments", { stripeEnabled: body.stripeEnabled, stripeMode: body.stripeMode });
  return ok(c, saved);
});
admin.post("/payments/settings/test", async (c) => ok(c, await testStripe(c.get("db"), c.env)));
admin.get("/payments", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  return ok(c, await listAdminPayments(c.get("db"), { status: c.req.query("status") || undefined, q: c.req.query("q") || undefined, from: c.req.query("from") || undefined, to: c.req.query("to") || undefined, page: Number.isFinite(page) ? page : 1 }));
});
admin.get("/payments/topups", async (c) => ok(c, await listPendingTopups(c.get("db"))));
admin.get("/payments/topups/:id/proof", async (c) => {
  const object = await readTransferProof(c.get("db"), c.env.PHOTOS, c.req.param("id"), { id: c.get("user").id, isAdmin: true });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=3600" } });
});
admin.post("/payments/topups/:id", async (c) => {
  const body = parse(z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(240).optional().default("") }), await c.req.json());
  const reviewed = await reviewBankTransfer(c.get("db"), c.get("user").email, c.req.param("id"), body.decision, body.note);
  await recordAudit(c.get("db"), c.get("user"), "payments.topup", c.req.param("id"), { decision: body.decision });
  return ok(c, reviewed);
});
admin.get("/payments/refunds", async (c) => ok(c, await listRefunds(c.get("db"))));
admin.post("/payments/:id/refund", async (c) => {
  const body = parse(z.object({ amountFen: z.number().int().positive(), note: z.string().max(240).optional().default("") }), await c.req.json());
  const refunded = await refundPayment(c.get("db"), c.env, c.req.param("id"), body.amountFen, body.note);
  await recordAudit(c.get("db"), c.get("user"), "payments.refund", c.req.param("id"), { amountFen: body.amountFen });
  return ok(c, refunded);
});
admin.post("/payments/:id/retry-hiobuy", async (c) => ok(c, await retryHiobuyPayment(c.get("db"), c.req.param("id"))));

admin.get("/settings/fulfillment-sync", async (c) => {
  const { fulfillmentSyncList } = await import("./fulfillment-sync");
  return ok(c, await fulfillmentSyncList(c.get("db"), { entity: c.req.query("entity") ?? "", bucket: c.req.query("status") ?? "" }));
});
admin.get("/settings/fulfillment-sync/:id", async (c) => {
  const { fulfillmentSyncDetail } = await import("./fulfillment-sync");
  return ok(c, await fulfillmentSyncDetail(c.get("db"), c.req.param("id")));
});
admin.post("/settings/fulfillment-sync/scan", async (c) => {
  const { scanHistoricalSync } = await import("./fulfillment-sync");
  return ok(c, await scanHistoricalSync(c.get("db")));
});
admin.post("/settings/fulfillment-sync/enqueue", async (c) => {
  const body = parse(z.object({ ids: z.array(z.string().min(1)).min(1).max(50) }), await c.req.json());
  const { enqueueSyncCandidates } = await import("./fulfillment-sync");
  return ok(c, await enqueueSyncCandidates(c.get("db"), body.ids));
});
admin.post("/settings/fulfillment-sync/:id/retry", async (c) => {
  const { retrySyncTask, processDueFulfillment } = await import("./fulfillment-sync");
  const result = await retrySyncTask(c.get("db"), c.req.param("id"));
  await processDueFulfillment(c.get("db"), c.env, 3);
  return ok(c, result);
});
admin.get("/settings/hiobuy-webhook", async (c) => {
  const { hiobuyWebhookActivity } = await import("./fulfillment-sync");
  return ok(c, await hiobuyWebhookActivity(c.get("db")));
});
admin.delete("/settings/hiobuy-webhook/balance-alert", async (c) => {
  const { clearBalanceAlert } = await import("./fulfillment-sync");
  return ok(c, await clearBalanceAlert(c.get("db")));
});
admin.put("/settings/hiobuy-webhook", async (c) => {
  const body = parse(z.object({ secret: z.string().max(400) }), await c.req.json());
  const { saveHiobuyWebhookSecret } = await import("./fulfillment-sync");
  const saved = await saveHiobuyWebhookSecret(c.get("db"), c.env, body.secret);
  await recordAudit(c.get("db"), c.get("user"), "secrets.webhook", "hiobuy", {});
  return ok(c, saved);
});

admin.get("/settings/tracking-events", async (c) => ok(c, await trackingEventLabelView(c.get("db"))));

admin.put("/settings/tracking-events", async (c) => {
  const body = parse(z.object({ labels: z.record(z.string(), z.string().max(80)) }), await c.req.json());
  return ok(c, await saveTrackingEventLabels(c.get("db"), body.labels));
});

const invoicingSchema = z.object({
  businessName: z.string().trim().max(120),
  businessAddress: z.string().trim().max(400),
  countryRegion: z.string().trim().max(80),
  taxId: z.string().trim().max(40),
  contactEmail: z.string().trim().max(120).refine((value) => value === "" || z.email().safeParse(value).success, "Enter a valid email."),
  invoicePrefix: z.string().trim().regex(/^[A-Za-z0-9]{2,8}$/, "Invoice prefix: use 2 to 8 letters or numbers, such as INV. The dash before the year is added for you."),
  invoiceFooter: z.string().trim().max(500),
  paymentInstructions: z.string().trim().max(500),
  defaultCurrency: z.string().trim().regex(/^[A-Z]{3}$/, "Default currency: use a 3-letter currency code, such as USD."),
  taxRateBps: z.number().int().min(0).max(10_000),
});

admin.get("/settings/invoicing", async (c) => {
  const { invoicingSettingsView } = await import("./invoicing");
  return ok(c, await invoicingSettingsView(c.get("db")));
});
admin.put("/settings/invoicing", async (c) => {
  const { saveInvoicingSettings } = await import("./invoicing");
  return ok(c, await saveInvoicingSettings(c.get("db"), parse(invoicingSchema, await c.req.json())));
});
admin.post("/settings/invoicing/logo", async (c) => {
  const body = await c.req.formData();
  const file = body.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "Choose a logo file.");
  const { saveInvoicingLogo } = await import("./invoicing");
  return ok(c, await saveInvoicingLogo(c.get("db"), c.env.PHOTOS, file));
});
admin.delete("/settings/invoicing/logo", async (c) => {
  const { clearInvoicingLogo } = await import("./invoicing");
  return ok(c, await clearInvoicingLogo(c.get("db"), c.env.PHOTOS));
});
admin.get("/settings/invoicing/logo", async (c) => {
  const { readInvoicingLogo } = await import("./invoicing");
  const logo = await readInvoicingLogo(c.get("db"), c.env.PHOTOS);
  if (!logo) throw new AppError("NOT_FOUND", "No logo uploaded.", 404);
  return new Response(logo.bytes, { headers: { "Content-Type": logo.contentType, "Cache-Control": "private, no-store" } });
});
admin.post("/settings/invoicing/preview", async (c) => {
  const { pdfResponse, previewInvoicingPdf } = await import("./invoicing");
  const file = await previewInvoicingPdf(c.get("db"), c.env.PHOTOS, parse(invoicingSchema, await c.req.json()));
  return pdfResponse(file.bytes, file.filename, true);
});

const businessSchema = z.object({
  name: z.string().max(80),
  legalName: z.string().max(120).optional().default(""),
  email: z.string().max(120),
  supportEmail: z.string().max(120).optional().default(""),
  phone: z.string().max(40).optional().default(""),
  country: z.string().max(80).optional().default(""),
  address: z.string().max(400).optional().default(""),
  description: z.string().max(400).optional().default(""),
  primaryColor: z.string().max(7),
  accentColor: z.string().max(7).optional().default(""),
  publicUrl: z.string().max(400).optional().default(""),
  appUrl: z.string().max(400).optional().default(""),
  supportUrl: z.string().max(400).optional().default(""),
  privacyUrl: z.string().max(400).optional().default(""),
  termsUrl: z.string().max(400).optional().default(""),
  browserTitle: z.string().max(80).optional().default(""),
  metaDescription: z.string().max(200).optional().default(""),
});

admin.get("/settings/business", async (c) => {
  const { adminBusinessView } = await import("./business");
  return ok(c, await adminBusinessView(c.get("db"), c.env, new URL(c.req.url).origin));
});
admin.put("/settings/business", async (c) => {
  const { saveBusiness } = await import("./business");
  const actor = c.get("staff");
  return ok(c, await saveBusiness(c.get("db"), c.env, actor, parse(businessSchema, await c.req.json()), new URL(c.req.url).origin));
});
admin.post("/settings/business/assets/:kind", async (c) => {
  const body = await c.req.formData();
  const file = body.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "Choose an image file.");
  const { saveBrandAsset } = await import("./business");
  return ok(c, await saveBrandAsset(c.get("db"), c.env.PHOTOS, c.get("staff"), c.req.param("kind"), file));
});
admin.delete("/settings/business/assets/:kind", async (c) => {
  const { clearBrandAsset } = await import("./business");
  return ok(c, await clearBrandAsset(c.get("db"), c.env.PHOTOS, c.get("staff"), c.req.param("kind")));
});

admin.get("/settings", async (c) => {
  const view = await settingsView(c.get("db"));
  if (!view.connection.configured && c.env.HIOBUY_API_TOKEN?.trim()) {
    return ok(c, { ...view, connection: { configured: true, hint: "Environment" } });
  }
  return ok(c, view);
});

admin.get("/settings/hiobuy-wallet", async (c) => ok(c, await hioBuyBalanceView(c.get("db"), c.env.HIOBUY_API_TOKEN)));

admin.get("/settings/hiobuy-wallet/transactions", async (c) => {
  const page = Number(c.req.query("page") ?? 1);
  return ok(c, await hioBuyTransactionsView(c.get("db"), c.env.HIOBUY_API_TOKEN, {
    category: c.req.query("category") || undefined,
    from: c.req.query("from") || undefined,
    to: c.req.query("to") || undefined,
    page: Number.isFinite(page) ? page : 1,
  }));
});

admin.get("/settings/hiobuy-wallet/transactions/:id", async (c) => ok(c, await hioBuyTransactionView(c.get("db"), c.env.HIOBUY_API_TOKEN, c.req.param("id"))));

admin.put("/settings/package-sync", async (c) => {
  const body = parse(z.object({ enabled: z.boolean() }), await c.req.json());
  return ok(c, await saveAutoSyncPackages(c.get("db"), body.enabled));
});

admin.put("/settings/api-key", async (c) => {
  const body = parse(z.object({ apiKey: z.string().max(400) }), await c.req.json());
  const saved = await saveApiKey(c.get("db"), body.apiKey);
  await recordAudit(c.get("db"), c.get("user"), "secrets.api_key", "hiobuy", { cleared: body.apiKey.trim().length === 0 });
  return ok(c, saved);
});

admin.put("/settings/pricing", async (c) => {
  const body = parse(
    z.object({
      markupPercent: z.string(),
      markupYuan: z.string(),
      rate: z.string(),
    }),
    await c.req.json(),
  );
  const markupBps = parsePercentBps(body.markupPercent);
  const markupCnyFen = yuanToFen(body.markupYuan);
  const rate = parseRateE4(body.rate);
  if (markupBps === null) throw new AppError("VALIDATION_ERROR", "Enter a markup percent from 0 to 100.");
  if (markupCnyFen === null) throw new AppError("VALIDATION_ERROR", "Enter a fixed yuan amount, or 0.");
  if (rate === null) throw new AppError("VALIDATION_ERROR", "Enter how many yuan equal 1 USD, such as 7.2000.");
  return ok(c, await savePricing(c.get("db"), { markupBps, markupCnyFen, cnyPerUsdE4: rate }));
});

admin.post("/settings/connect", async (c) => {
  const body = parse(z.object({ apiKey: z.string().max(400) }), await c.req.json());
  const saved = await connectHioBuy(c.get("db"), body.apiKey);
  await recordAudit(c.get("db"), c.get("user"), "secrets.api_key", "hiobuy", { connected: true });
  return ok(c, saved);
});

admin.post("/settings/test", async (c) => {
  const body = z.object({ apiKey: z.string().max(400).optional() }).safeParse(await c.req.json().catch(() => ({})));
  const typed = c.get("staff").role === "owner" && body.success ? body.data.apiKey?.trim() : "";
  const token = typed || (await resolveHioBuyToken(c.get("db"), c.env.HIOBUY_API_TOKEN));
  return ok(c, await verifyHioBuyAccess(token, !typed));
});

admin.put("/settings/countries", async (c) => {
  const body = parse(z.object({ enabled: z.boolean() }), await c.req.json());
  return ok(c, await setAllCountries(c.get("db"), body.enabled));
});

admin.put("/settings/countries/:code", async (c) => {
  const body = parse(z.object({ enabled: z.boolean() }), await c.req.json());
  return ok(c, await setCountryEnabled(c.get("db"), c.req.param("code").toUpperCase(), body.enabled));
});

admin.post("/settings/sync/channels", async (c) => {
  const token = await tokenForSync(c);
  return ok(c, await syncFreightDestinations(c.get("db"), token));
});

admin.post("/settings/sync/warehouse", async (c) => {
  const token = await tokenForSync(c);
  return ok(c, await syncWarehouseAddress(c.get("db"), token));
});

/* ---------- Overview ---------- */

admin.get("/overview", async (c) => {
  const db = c.get("db");
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const [users, pkgs, ships, walletRows, txRows, openClaims, openQuestions, published, pendingTopups] = await Promise.all([
    db.select({ id: user.id, createdAt: user.createdAt }).from(user),
    loadPackageGraph(db, null),
    loadShipments(db, null),
    db.select().from(wallets),
    db.select().from(walletTransactions).where(inArray(walletTransactions.type, ["TOP_UP", "SHIPMENT_PAYMENT"])),
    db.select({ id: claims.id }).from(claims).where(eq(claims.status, "PENDING")),
    db.select({ id: assistantUnanswered.id }).from(assistantUnanswered).where(eq(assistantUnanswered.status, "open")),
    db.select({ id: assistantKnowledge.id }).from(assistantKnowledge).where(eq(assistantKnowledge.status, "published")),
    db.select({ id: bankTransfers.id }).from(bankTransfers).where(eq(bankTransfers.status, "pending")),
  ]);

  const packageStatus = PACKAGE_FILTERS.filter((item) => item.key !== "all" && item.key !== "exception").map((item) => ({
    key: item.key,
    label: item.label,
    count: pkgs.filter((pkg) => pkg.displayStatus.key === item.key).length,
  }));
  const shipmentStatus = ADMIN_SHIPMENT_FILTERS.filter((item) => item.key !== "all").map((item) => ({
    key: item.key,
    label: item.label,
    count: ships.filter((shipment) => adminShipmentMatches(fulfillmentOf(shipment), item.key)).length,
  }));
  const since30 = now - 30 * day;
  return ok(c, {
    users: {
      total: users.length,
      newLast7Days: users.filter((row) => row.createdAt.getTime() >= now - 7 * day).length,
    },
    packages: { total: pkgs.length, byStatus: packageStatus, inWarehouse: pkgs.filter((pkg) => pkg.receivedAt && !["shipped", "delivered", "discarded", "archived"].includes(pkg.displayStatus.key)).length },
    shipments: {
      total: ships.length,
      byStatus: shipmentStatus,
      toPayFen: ships.filter((item) => item.status === "TO_PAY").reduce((sum, item) => sum + item.amountFen, 0),
    },
    wallet: {
      balanceFen: walletRows.reduce((sum, row) => sum + row.balanceFen, 0),
      topUpsLast30DaysFen: txRows.filter((row) => row.type === "TOP_UP" && row.createdAt >= since30).reduce((sum, row) => sum + row.amountFen, 0),
      paymentsLast30DaysFen: -txRows.filter((row) => row.type === "SHIPMENT_PAYMENT" && row.createdAt >= since30).reduce((sum, row) => sum + row.amountFen, 0),
    },
    queues: {
      toReceive: pkgs.filter((pkg) => pkg.displayStatus.key === "pending").length,
      servicesOpen: pkgs.filter((pkg) => pkg.vasRequests.some((request) => request.status === "REQUESTED" || request.status === "PROCESSING")).length,
      waitingOnCustomer: pkgs.filter((pkg) => pkg.conditionStatus === "EXCEPTION").length,
      toPack: ships.filter((item) => fulfillmentOf(item).key === "pending" || fulfillmentOf(item).key === "local").length,
      toDispatch: ships.filter((item) => fulfillmentOf(item).key === "wait_ship").length,
      inTransit: ships.filter((item) => fulfillmentOf(item).key === "shipped").length,
      unclaimed: openClaims.length,
      unansweredQuestions: openQuestions.length,
      publishedAnswers: published.length,
      pendingTopups: pendingTopups.length,
      hiobuyPaymentsPending: ships.filter((item) => item.hiobuyShipmentId && item.hiobuyStatus === "WAIT_PAYMENT" && item.hiobuyPaymentStatus !== "PAID" && (item.status === "READY_TO_SHIP" || item.status === "SHIPPED" || item.status === "IN_TRANSIT" || item.status === "DELIVERED")).length,
    },
  });
});

admin.get("/earnings", async (c) => {
  const range = c.req.query("range");
  const selected = range === "today" || range === "7d" || range === "30d" ? range : "30d";
  return ok(c, await earningsSummary(c.get("db"), selected));
});

/** Cost and profit columns need earnings.read. Other staff get the customer view. */
function calculatorAudience(staff: StaffActor): "public" | "admin" {
  return can(staff.role, "earnings.read") ? "admin" : "public";
}

admin.get("/calculator/options", async (c) => ok(c, await calculatorOptions(c.get("db"), c.env.HIOBUY_API_TOKEN)));

admin.post("/calculator", async (c) => {
  if (!allowQuoteAttempt(`user:${c.get("user").id}`, 40, 10 * 60 * 1000)) throw new AppError("RATE_LIMITED", "Too many quote requests. Wait a moment and try again.", 429);
  return ok(c, await estimateShipping(c.get("db"), c.env.HIOBUY_API_TOKEN, parseCalculatorInput(await c.req.json()), calculatorAudience(c.get("staff"))));
});

admin.get("/calculator/channel", async (c) => {
  if (!allowQuoteAttempt(`user:${c.get("user").id}`, 40, 10 * 60 * 1000)) throw new AppError("RATE_LIMITED", "Too many quote requests. Wait a moment and try again.", 429);
  return ok(c, await channelDetail(c.get("db"), c.env.HIOBUY_API_TOKEN, c.req.query("code") ?? "", (c.req.query("country") ?? "").toUpperCase(), calculatorAudience(c.get("staff"))));
});

/* ---------- Packages ---------- */

admin.get("/packages", async (c) => {
  const db = c.get("db");
  const status = c.req.query("status") ?? "all";
  const q = (c.req.query("q") ?? "").trim();
  const cargo = c.req.query("cargo") ?? "";
  const link = c.req.query("link") ?? "all";
  const condition = c.req.query("condition") ?? "all";
  const vas = c.req.query("vas") ?? "";
  const from = dayBound(c.req.query("from"), false);
  const to = dayBound(c.req.query("to"), true);
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const narrowed = from != null || to != null || link === "linked" || link === "unlinked" || Boolean(q);
  let ids: string[] | undefined;
  if (narrowed) {
    const filters = [];
    if (from != null) filters.push(gte(packages.createdAt, from));
    if (to != null) filters.push(lte(packages.createdAt, to));
    if (link === "linked") filters.push(isNotNull(packages.hiobuySyncedAt));
    if (link === "unlinked") filters.push(isNull(packages.hiobuySyncedAt));
    const rows = await db
      .select({ id: packages.id, userId: packages.userId, publicId: packages.publicId, tracking: packages.domesticTrackingNumber })
      .from(packages)
      .where(filters.length ? and(...filters) : undefined);
    const people = q
      ? await db
          .select({ id: user.id, name: user.name, email: user.email, memberCode: user.memberCode })
          .from(user)
          .where(or(like(user.email, `%${q}%`), like(user.name, `%${q}%`), like(user.memberCode, `%${q}%`)))
      : [];
    const ownerIds = new Set(people.map((person) => person.id));
    ids = rows.filter((row) => !q || ownerIds.has(row.userId) || matches(`${row.publicId} ${row.tracking}`, q)).map((row) => row.id);
  }
  const all = await loadPackageGraph(db, null, ids);
  const who = await owners(db, all.map((item) => item.ownerId));
  const scoped = all
    .map(({ photos: _photos, updatedAt: _updated, ...item }) => ({ ...item, owner: who.get(item.ownerId) ?? null }))
    .filter((item) => !cargo || item.cargoAttributes.includes(cargo as (typeof CARGO_ATTRIBUTES)[number]))
    .filter((item) => !q || matches(`${item.publicId} ${item.domesticTrackingNumber} ${item.owner?.memberCode ?? ""} ${item.owner?.email ?? ""} ${item.owner?.name ?? ""}`, q))
    .filter((item) => condition === "all" || item.conditionStatus === (condition === "exception" ? "EXCEPTION" : "NORMAL"))
    .filter((item) => vas !== "open" || item.vasRequests.some((request) => request.status === "REQUESTED" || request.status === "PROCESSING"));
  const { decoratePackageSync } = await import("./fulfillment-sync");
  const labels = await decoratePackageSync(db, scoped.map((item) => ({ id: item.id, packageStatus: item.packageStatus, disposition: item.disposition ?? "NONE", remotePackageId: item.remotePackageId })));
  const decorated = scoped.map((item) => ({ ...item, ...labels.get(item.id) })).filter((item) => {
    if (link === "all") return true;
    if (link === "linked" || link === "synced") return item.syncLabel === "Synced";
    if (link === "unlinked" || link === "not_synced") return item.syncLabel === "Not synced" || item.syncLabel === "Not Connected";
    if (link === "pending") return item.syncLabel === "Pending" || item.syncLabel === "Syncing";
    if (link === "failed") return item.syncLabel === "Failed";
    if (link === "needs_review") return item.syncLabel === "Needs review";
    return true;
  });
  const counts = countsFor(decorated, PACKAGE_ADMIN_FILTERS, (item, key) => (key === "exception" ? item.conditionStatus === "EXCEPTION" : item.displayStatus.key === key));
  const filtered = decorated.filter((item) => status === "all" || (status === "exception" ? item.conditionStatus === "EXCEPTION" : item.displayStatus.key === status));
  const pageResult = paginate(filtered, page, 25);
  return ok(c, {
    ...pageResult,
    counts,
    items: pageResult.items.map((item) => ({ ...item, ...labels.get(item.id) })),
  });
});

admin.post("/packages/sync", async (c) => {
  const body = parse(z.object({ ids: z.array(z.string().min(1)).min(1).max(25) }), await c.req.json());
  const { queueSelectedPackages } = await import("./fulfillment-sync");
  return ok(c, await queueSelectedPackages(c.get("db"), c.env, body.ids));
});

admin.post("/packages/pull", async (c) => {
  const body = parse(z.object({ ids: z.array(z.string().min(1)).max(25).optional(), scope: z.enum(["selected", "linked"]).default("selected") }), await c.req.json());
  const { pullPackageStatuses } = await import("./fulfillment-sync");
  if (body.scope === "linked") return ok(c, await pullPackageStatuses(c.get("db"), c.env));
  if (!body.ids?.length) throw new AppError("VALIDATION_ERROR", "Select at least one package.");
  return ok(c, await pullPackageStatuses(c.get("db"), c.env, body.ids));
});

admin.get("/packages/:id", async (c) => {
  const db = c.get("db");
  const { refreshPackageMedia } = await import("./fulfillment-sync");
  await refreshPackageMedia(db, c.req.param("id"), c.env.HIOBUY_API_TOKEN).catch(() => undefined);
  const item = (await loadPackageGraph(db, null)).find((pkg) => pkg.id === c.req.param("id"));
  if (!item) throw new AppError("NOT_FOUND", "Package not found.", 404);
  const who = await owners(db, [item.ownerId]);
  const { updatedAt: _updated, ...dto } = item;
  const { decoratePackageSync } = await import("./fulfillment-sync");
  const labels = await decoratePackageSync(db, [{ id: item.id, packageStatus: item.packageStatus, disposition: item.disposition, remotePackageId: item.remotePackageId }]);
  const { packageActivity } = await import("./data");
  return ok(c, { ...dto, owner: who.get(item.ownerId) ?? null, ...labels.get(item.id), timeline: await packageActivity(db, item.id, "admin", item.timeline) });
});

admin.delete("/packages/:id", async (c) => {
  const db = c.get("db");
  const { deletePendingPackage } = await import("./data");
  const removed = await deletePendingPackage(db, c.env, c.req.param("id"), null);
  await recordAudit(db, c.get("user"), "packages.delete", removed.publicId, { packageId: removed.id, ownerId: removed.userId });
  await notify(db, removed.userId, { type: "PACKAGE_DELETED", title: "Pre-alert cancelled", body: `${removed.publicId} was cancelled by the warehouse team before it arrived.`, href: "/app/packages" });
  return ok(c, { id: removed.id, publicId: removed.publicId });
});

admin.get("/packages/:id/sync", async (c) => {
  const { packageSyncLog } = await import("./fulfillment-sync");
  return ok(c, await packageSyncLog(c.get("db"), c.req.param("id")));
});

admin.get("/vas/catalog", (c) => ok(c, vasCatalog));

admin.post("/packages/:id/exceptions", async (c) => {
  const db = c.get("db");
  const body = parse(z.object({ action: z.string().min(1) }), await c.req.json());
  const pkg = await packageRow(db, c.req.param("id"));
  const result = await resolveException(db, pkg.userId, pkg.id, body.action);
  if (body.action !== "SUPPORT") {
    await notify(db, pkg.userId, {
      type: "EXCEPTION",
      title: "We replied to a package exception",
      body: `${pkg.publicId}: ${body.action.replaceAll("_", " ").toLowerCase()}.`,
      href: `/app/packages/${pkg.id}`,
    });
  }
  return ok(c, result);
});

admin.post("/packages/:id/vas", async (c) => {
  const db = c.get("db");
  const body = parse(z.object({ serviceCode: z.string().min(1), note: z.string().max(300).optional() }), await c.req.json());
  const pkg = await packageRow(db, c.req.param("id"));
  const result = await requestVas(db, pkg.userId, pkg.id, body.serviceCode, body.note, c.req.header("Idempotency-Key") ?? null);
  await notify(db, pkg.userId, {
    type: "VAS",
    title: "A warehouse service was requested",
    body: `A service was requested for ${pkg.publicId}.`,
    href: `/app/packages/${pkg.id}`,
  });
  return ok(c, result);
});

const receiveSchema = z.object({
  weightGrams: z.number().int().min(1).max(100000),
  lengthMm: z.number().int().min(10).max(3000),
  widthMm: z.number().int().min(10).max(3000),
  heightMm: z.number().int().min(10).max(3000),
  cargo: z.array(z.enum(CARGO_ATTRIBUTES)).min(1).optional(),
});

admin.post("/packages/:id/receive", async (c) => {
  const body = parse(receiveSchema, await c.req.json());
  return ok(c, await receivePackage(c.get("db"), c.req.param("id"), body));
});

const exceptionSchema = z.object({
  type: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(300),
  message: z.string().trim().max(300).optional(),
});

admin.post("/packages/:id/exception", async (c) => {
  const db = c.get("db");
  const body = parse(exceptionSchema, await c.req.json());
  const pkg = await packageRow(db, c.req.param("id"));
  if (pkg.packageStatus !== "RECEIVED") throw new AppError("INVALID_STATE", "Only received packages can have an exception.", 409);
  if (pkg.lockStatus === "LOCKED") throw new AppError("INVALID_STATE", `${pkg.publicId} is already in a shipment.`, 409);
  if (pkg.exceptionStatus === "ACTION_REQUIRED") throw new AppError("INVALID_STATE", `${pkg.publicId} already has an open exception.`, 409);
  const now = Date.now();
  await db.insert(packageExceptions).values({
    id: crypto.randomUUID(),
    packageId: pkg.id,
    type: body.type,
    description: body.description,
    message: body.message ?? "Please choose how the warehouse should handle this package.",
    status: "OPEN",
    resolution: null,
    createdAt: now,
  });
  await db.update(packages).set({ exceptionStatus: "ACTION_REQUIRED", conditionStatus: "EXCEPTION", updatedAt: now }).where(eq(packages.id, pkg.id));
  await notify(db, pkg.userId, { type: "EXCEPTION", title: "Package needs your decision", body: `${pkg.publicId}: ${body.type}`, href: `/app/packages/${pkg.id}` });
  return ok(c, { id: pkg.id });
});

admin.post("/packages/:id/complete-services", async (c) => {
  const db = c.get("db");
  const pkg = await packageRow(db, c.req.param("id"));
  const open = await db.select().from(vasRequests).where(and(eq(vasRequests.packageId, pkg.id), inArray(vasRequests.status, ["REQUESTED", "PROCESSING"])));
  if (!open.length) throw new AppError("INVALID_STATE", `${pkg.publicId} has no open service requests.`, 409);
  const now = Date.now();
  for (const request of open) {
    await db.update(vasRequests).set({ status: "COMPLETED", finalFen: request.finalFen ?? request.estimatedFen }).where(eq(vasRequests.id, request.id));
  }
  await db.insert(packagePhotos).values({ id: crypto.randomUUID(), packageId: pkg.id, shipmentId: null, type: "SERVICE", label: open.map((item) => item.serviceName).join(", "), createdAt: now });
  await db.update(packages).set({ vasStatus: "COMPLETED", updatedAt: now }).where(eq(packages.id, pkg.id));
  await notify(db, pkg.userId, { type: "VAS", title: "Service completed", body: `${open.map((item) => item.serviceName).join(", ")} for ${pkg.publicId} is done.`, href: `/app/packages/${pkg.id}` });
  return ok(c, { id: pkg.id });
});

/* ---------- Shipments ---------- */

admin.get("/shipments", async (c) => {
  const db = c.get("db");
  const status = c.req.query("status") ?? "all";
  const q = (c.req.query("q") ?? "").trim();
  const country = (c.req.query("country") ?? "").toUpperCase();
  const link = c.req.query("link") ?? "all";
  const from = dayBound(c.req.query("from"), false);
  const to = dayBound(c.req.query("to"), true);
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const narrowed = from != null || to != null || link === "linked" || link === "unlinked" || Boolean(q);
  let ids: string[] | undefined;
  if (narrowed) {
    const filters = [];
    if (from != null) filters.push(gte(shipments.createdAt, from));
    if (to != null) filters.push(lte(shipments.createdAt, to));
    if (link === "linked") filters.push(isNotNull(shipments.hiobuySyncedAt));
    if (link === "unlinked") filters.push(isNull(shipments.hiobuySyncedAt));
    const rows = await db
      .select({ id: shipments.id, userId: shipments.userId, publicId: shipments.publicId, tracking: shipments.trackingNumber })
      .from(shipments)
      .where(filters.length ? and(...filters) : undefined);
    const people = q
      ? await db
          .select({ id: user.id })
          .from(user)
          .where(or(like(user.email, `%${q}%`), like(user.name, `%${q}%`), like(user.memberCode, `%${q}%`)))
      : [];
    const ownerIds = new Set(people.map((person) => person.id));
    ids = rows.filter((row) => !q || ownerIds.has(row.userId) || matches(`${row.publicId} ${row.tracking ?? ""}`, q)).map((row) => row.id);
  }
  const all = await loadShipments(db, null, ids);
  const who = await owners(db, all.map((item) => item.ownerId));
  const scoped = all
    .map(({ updatedAt: _updated, photos: _photos, ...item }) => ({ ...item, owner: who.get(item.ownerId) ?? null }))
    .filter((item) => !country || item.destination?.countryCode === country)
    .filter((item) => !q || matches(`${item.publicId} ${item.trackingNumber ?? ""} ${item.owner?.memberCode ?? ""} ${item.owner?.email ?? ""} ${item.owner?.name ?? ""}`, q));
  const counts = countsFor(scoped, ADMIN_SHIPMENT_FILTERS, (item, key) => adminShipmentMatches(fulfillmentOf(item), key));
  const filtered = scoped.filter((item) => adminShipmentMatches(fulfillmentOf(item), status));
  const pageResult = paginate(filtered, page, 25);
  const views = await earningViewsFor(c.get("db"), pageResult.items.map((item) => item.id));
  const { syncLabelsFor } = await import("./fulfillment-sync");
  const labels = await syncLabelsFor(db, "shipment", pageResult.items.map((item) => item.id));
  return ok(c, {
    ...pageResult,
    counts,
    items: pageResult.items.map((item) => ({
      ...item,
      earning: presentEarning(views.get(item.id)!),
      syncLabel: labels.get(item.id)?.label ?? (item.hiobuyShipmentId ? "Synced" : "Not linked"),
      syncRemoteId: labels.get(item.id)?.remoteId ?? item.hiobuyShipmentId,
      fulfillment: fulfillmentOf(item),
      customerPayment: customerPaymentLabel(item.status, item.charges.some((charge) => charge.status === "DUE")),
      hiobuyPayment: hiobuyPaymentLabel(item.hiobuyPaymentStatus),
      canPull: Boolean(item.hiobuyShipmentId),
      canPayHioBuy: canPayHioBuy(item),
    })),
  });
});

admin.post("/shipments/hiobuy-pay", async (c) => {
  const body = parse(z.object({ ids: z.array(z.string().min(1)).min(1).max(25) }), await c.req.json());
  const { hiobuyPay2faRequired } = await import("./platform");
  if (await hiobuyPay2faRequired(c.get("db"))) throw new AppError("FORBIDDEN", "Pay one shipment at a time so each payment has its own authenticator code.", 403);
  const { payHiobuyShipments } = await import("./fulfillment-sync");
  const paid = await payHiobuyShipments(c.get("db"), c.env, body.ids);
  await recordAudit(c.get("db"), c.get("user"), "shipments.hiobuy_pay", body.ids.join(","), { count: body.ids.length });
  return ok(c, paid);
});

admin.post("/shipments/pull", async (c) => {
  const body = parse(z.object({ ids: z.array(z.string().min(1)).max(25).optional(), scope: z.enum(["selected", "linked"]).default("selected") }), await c.req.json());
  const { pullShipmentStatuses } = await import("./fulfillment-sync");
  if (body.scope === "linked") return ok(c, await pullShipmentStatuses(c.get("db"), c.env));
  if (!body.ids?.length) throw new AppError("VALIDATION_ERROR", "Select at least one shipment.");
  return ok(c, await pullShipmentStatuses(c.get("db"), c.env, body.ids));
});

admin.get("/shipments/:id/documents", async (c) => {
  const { shipmentDocumentState } = await import("./invoicing");
  return ok(c, await shipmentDocumentState(c.get("db"), c.req.param("id"), null));
});
admin.post("/shipments/:id/documents", async (c) => {
  const body = parse(z.object({ kind: z.enum(["proforma", "shipping_invoice", "payment_receipt"]), profileId: z.string().min(1).nullable().optional() }), await c.req.json());
  const { issueShipmentDocument } = await import("./invoicing");
  return ok(c, await issueShipmentDocument(c.get("db"), c.req.param("id"), body.kind, null, body.profileId ?? null));
});
admin.post("/documents/:id/void", async (c) => {
  const body = parse(z.object({ reason: z.string().trim().min(1).max(240) }), await c.req.json());
  const { voidUnpaidDocument } = await import("./invoicing");
  return ok(c, await voidUnpaidDocument(c.get("db"), c.req.param("id"), body.reason));
});
admin.get("/documents/:id/pdf", async (c) => {
  const { documentPdf, pdfResponse } = await import("./invoicing");
  const file = await documentPdf(c.get("db"), c.env.PHOTOS, c.req.param("id"), null);
  return pdfResponse(file.bytes, file.filename, c.req.query("inline") === "1");
});

admin.get("/shipments/:id", async (c) => {
  const db = c.get("db");
  const { refreshShipmentMedia } = await import("./fulfillment-sync");
  await refreshShipmentMedia(db, c.req.param("id"), c.env.HIOBUY_API_TOKEN).catch(() => undefined);
  const item = (await loadShipments(db, null)).find((shipment) => shipment.id === c.req.param("id"));
  if (!item) throw new AppError("NOT_FOUND", "Shipment not found.", 404);
  const who = await owners(db, [item.ownerId]);
  const { updatedAt: _updated, ...dto } = item;
  const views = await earningViewsFor(db, [item.id]);
  const { syncLabelsFor } = await import("./fulfillment-sync");
  const labels = await syncLabelsFor(db, "shipment", [item.id]);
  return ok(c, {
    ...dto,
    owner: who.get(item.ownerId) ?? null,
    earning: presentEarning(views.get(item.id)!),
    syncLabel: labels.get(item.id)?.label ?? (item.hiobuyShipmentId ? "Synced" : "Not linked"),
    syncRemoteId: labels.get(item.id)?.remoteId ?? item.hiobuyShipmentId,
    fulfillment: fulfillmentOf(item),
    customerPayment: customerPaymentLabel(item.status, item.charges.some((charge) => charge.status === "DUE")),
    hiobuyPayment: hiobuyPaymentLabel(item.hiobuyPaymentStatus),
    canPull: Boolean(item.hiobuyShipmentId),
    canPayHioBuy: canPayHioBuy(item),
    timeline: await shipmentActivity(db, item.id, "admin", item.createdAt),
  });
});

admin.get("/shipments/:id/tracking", async (c) => {
  const { carrierTracking } = await import("./fulfillment-sync");
  return ok(c, await carrierTracking(c.get("db"), c.env, c.req.param("id"), null));
});

admin.get("/shipments/:id/sync", async (c) => {
  const { shipmentSyncLog } = await import("./fulfillment-sync");
  return ok(c, await shipmentSyncLog(c.get("db"), c.req.param("id")));
});

admin.get("/shipments/:id/hiobuy-pay", async (c) => {
  const { hiobuyPayQuote } = await import("./fulfillment-sync");
  const { payFactorState } = await import("./pay-factor");
  const quote = await hiobuyPayQuote(c.get("db"), c.env, c.req.param("id"));
  return ok(c, { ...quote, ...(await payFactorState(c.get("db"), c.get("user").id)) });
});

admin.post("/shipments/:id/hiobuy-pay", async (c) => {
  const body = parse(z.object({ code: z.string().trim().max(40).optional() }), await c.req.json().catch(() => ({})));
  const { authorizeHiobuyPay } = await import("./pay-factor");
  await authorizeHiobuyPay(c.get("db"), c.get("auth") as Parameters<typeof authorizeHiobuyPay>[1], c.req.raw.headers, c.get("user").id, c.req.param("id"), body.code ?? "");
  const { payHiobuyShipment } = await import("./fulfillment-sync");
  const paid = await payHiobuyShipment(c.get("db"), c.env, c.req.param("id"));
  await recordAudit(c.get("db"), c.get("user"), "shipments.hiobuy_pay", c.req.param("id"), { twoFactor: Boolean(body.code) });
  return ok(c, paid);
});

admin.post("/shipments/:id/intercept", async (c) => {
  const body = parse(z.object({
    reason: z.enum(["CUSTOMER_REQUEST", "ADDRESS_ISSUE", "ORDER_CHANGE", "PAYMENT_ISSUE", "COMPLIANCE_ISSUE", "PACKAGE_ISSUE", "OTHER"]),
    remark: z.string().trim().max(300).optional(),
  }), await c.req.json());
  if (body.reason === "OTHER" && !body.remark) throw new AppError("VALIDATION_ERROR", "A remark is required when the reason is Other.");
  const { requestShipmentIntercept } = await import("./fulfillment-sync");
  return ok(c, await requestShipmentIntercept(c.get("db"), c.env, c.req.param("id"), body.reason, body.remark ?? ""));
});

admin.post("/shipments/:id/earnings/finalize", async (c) => {
  return ok(c, await finalizeEarningCost(c.get("db"), c.req.param("id")));
});

admin.post("/shipments/:id/earnings/adjustments", async (c) => {
  const body = parse(
    z.object({
      kind: z.enum(["refund", "extra_charge", "cost"]),
      amount: z.string(),
      note: z.string().trim().min(2).max(160),
      idempotencyKey: z.string().trim().min(8).max(80),
    }),
    await c.req.json(),
  );
  const fen = yuanToFen(body.amount);
  if (fen == null) throw new AppError("VALIDATION_ERROR", "Enter an amount with up to 2 decimal places.");
  return ok(c, await recordEarningAdjustment(c.get("db"), c.req.param("id"), {
    kind: body.kind,
    usdFen: body.kind === "cost" ? 0 : fen,
    cnyFen: body.kind === "cost" ? fen : null,
    note: body.note,
    idempotencyKey: body.idempotencyKey,
  }));
});

admin.post("/shipments/:id/cancel", async (c) => {
  const db = c.get("db");
  const row = await shipmentRow(db, c.req.param("id"));
  const result = await cancelShipment(db, row.userId, row.id);
  await notify(db, row.userId, {
    type: "SHIPMENT",
    title: "Consolidation cancelled",
    body: `${row.publicId} was cancelled. The packages can be shipped again.`,
    href: `/app/shipments/${row.id}`,
  });
  return ok(c, result);
});

const packSchema = z.object({
  finalWeightGrams: z.number().int().min(1).max(300000),
  finalLengthMm: z.number().int().min(10).max(3000),
  finalWidthMm: z.number().int().min(10).max(3000),
  finalHeightMm: z.number().int().min(10).max(3000),
  freightFen: z.number().int().min(1).max(10_000_000),
});

admin.post("/shipments/:id/pack", async (c) => {
  const body = parse(packSchema, await c.req.json());
  return ok(c, await packShipment(c.get("db"), c.req.param("id"), body));
});

admin.post("/shipments/:id/dispatch", async (c) => {
  const body = parse(z.object({ trackingNumber: z.string().trim().min(6).max(40) }), await c.req.json());
  return ok(c, await dispatchShipment(c.get("db"), c.req.param("id"), body.trackingNumber));
});

admin.post("/shipments/:id/deliver", async (c) => {
  const db = c.get("db");
  const row = await shipmentRow(db, c.req.param("id"));
  if (row.status !== "IN_TRANSIT" && row.status !== "SHIPPED") throw new AppError("INVALID_STATE", `${row.publicId} is not in transit.`, 409);
  const now = Date.now();
  await db.update(shipments).set({ status: "DELIVERED", upstreamStatus: "SIGNED", updatedAt: now }).where(eq(shipments.id, row.id));
  const links = await db.select({ packageId: shipmentPackages.packageId }).from(shipmentPackages).where(eq(shipmentPackages.shipmentId, row.id));
  if (links.length) {
    await db
      .update(packages)
      .set({ packageStatus: "DELIVERED", updatedAt: now })
      .where(and(inArray(packages.id, links.map((link) => link.packageId)), inArray(packages.packageStatus, ["RECEIVED", "CONSOLIDATED", "SHIPPED"])));
  }
  await notify(db, row.userId, { type: "DELIVERED", title: "Shipment delivered", body: `${row.publicId} was delivered.`, href: `/app/shipments/${row.id}` });
  return ok(c, { id: row.id });
});

/* ---------- Users & wallets ---------- */

admin.get("/users", async (c) => {
  const db = c.get("db");
  const q = (c.req.query("q") ?? "").trim();
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pattern = `%${q}%`;
  const [rows, walletRows, packageRows, shipmentRows, staffRows] = await Promise.all([
    db
      .select({ id: user.id, name: user.name, email: user.email, memberCode: user.memberCode, country: user.country, status: user.status, emailVerified: user.emailVerified, createdAt: user.createdAt })
      .from(user)
      .where(q ? or(like(user.name, pattern), like(user.email, pattern), like(user.memberCode, pattern)) : undefined)
      .orderBy(desc(user.createdAt)),
    db.select().from(wallets),
    db.select({ userId: packages.userId }).from(packages),
    db.select({ userId: shipments.userId, status: shipments.status }).from(shipments),
    db.select({ userId: staffMembers.userId, role: staffMembers.role, status: staffMembers.status }).from(staffMembers),
  ]);
  const staffByUser = new Map(staffRows.map((item) => [item.userId, item]));
  const items = rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    isAdmin: staffByUser.get(row.id)?.status === "active",
    staffRole: staffByUser.get(row.id)?.status === "active" ? staffByUser.get(row.id)?.role ?? null : null,
    balanceFen: walletRows.find((wallet) => wallet.userId === row.id)?.balanceFen ?? 0,
    packageCount: packageRows.filter((item) => item.userId === row.id).length,
    shipmentCount: shipmentRows.filter((item) => item.userId === row.id).length,
    toPayCount: shipmentRows.filter((item) => item.userId === row.id && item.status === "TO_PAY").length,
  }));
  return ok(c, paginate(items, page, 25));
});

admin.get("/users/:id/transactions", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(walletTransactions).where(eq(walletTransactions.userId, c.req.param("id"))).orderBy(desc(walletTransactions.createdAt)).limit(20);
  return ok(
    c,
    rows.map((row) => ({ id: row.id, type: row.type, amountFen: row.amountFen, balanceAfter: row.balanceAfter, description: row.description, createdAt: new Date(row.createdAt).toISOString() })),
  );
});

admin.post("/users/:id/wallet", async (c) => {
  const db = c.get("db");
  const body = parse(
    z.object({
      amountFen: z.number().int().refine((value) => value !== 0, "Enter an amount other than 0.").refine((value) => Math.abs(value) <= 10_000_000, "That amount is too large."),
      note: z.string().trim().min(2, "Add a short reason. The customer sees it in wallet activity.").max(120),
    }),
    await c.req.json(),
  );
  const userId = c.req.param("id");
  const moved = await moveWallet(db, {
    userId,
    amountFen: body.amountFen,
    type: "ADJUSTMENT",
    referenceType: "ADMIN",
    referenceId: c.get("user").email,
    description: body.note,
    insufficientMessage: "The balance can't go below $0.",
    repeatable: true,
  });
  await recordAudit(c.get("db"), c.get("user"), "wallet.adjust", userId, { amountFen: body.amountFen });
  return ok(c, { balanceFen: moved.balanceFen });
});

async function tokenForSync(c: Context<AdminEnv>) {
  const body = z.object({ apiKey: z.string().max(400).optional() }).safeParse(await c.req.json().catch(() => ({})));
  const typed = c.get("staff").role === "owner" && body.success ? body.data.apiKey?.trim() ?? "" : "";
  if (typed) {
    await saveApiKey(c.get("db"), typed);
    await recordAudit(c.get("db"), c.get("user"), "secrets.api_key", "hiobuy", { connected: false });
  }
  return typed || (await resolveHioBuyToken(c.get("db"), c.env.HIOBUY_API_TOKEN));
}

/* ---------- Assistant knowledge ---------- */

admin.get("/assistant", async (c) => {
  const db = c.get("db");
  const [open, cards] = await Promise.all([
    db.select().from(assistantUnanswered).where(eq(assistantUnanswered.status, "open")).orderBy(desc(assistantUnanswered.createdAt)).limit(200),
    db.select().from(assistantKnowledge).where(inArray(assistantKnowledge.status, ["published", "archived"])).orderBy(desc(assistantKnowledge.updatedAt)),
  ]);
  const who = await owners(db, open.map((row) => row.userId));
  // The same question from several customers is answered once.
  const grouped = new Map<string, { id: string; question: string; normalized: string; askedBy: { memberCode: string; name: string }[]; ids: string[]; lastAskedAt: string }>();
  for (const row of open) {
    const entry = grouped.get(row.normalized);
    const asker = who.get(row.userId);
    if (entry) {
      entry.ids.push(row.id);
      if (asker) entry.askedBy.push({ memberCode: asker.memberCode, name: asker.name });
    } else {
      grouped.set(row.normalized, {
        id: row.id,
        question: row.question,
        normalized: row.normalized,
        askedBy: asker ? [{ memberCode: asker.memberCode, name: asker.name }] : [],
        ids: [row.id],
        lastAskedAt: new Date(row.createdAt).toISOString(),
      });
    }
  }
  return ok(c, {
    open: [...grouped.values()],
    answers: cards.map((row) => ({ id: row.id, question: row.question, answer: row.answer, keywords: row.keywords, status: row.status, updatedAt: new Date(row.updatedAt).toISOString() })),
  });
});

const answerSchema = z.object({
  question: z.string().trim().min(2, "Write the question.").max(300),
  answer: z.string().trim().min(2, "Write the answer.").max(2000),
  keywords: z.string().trim().max(300).optional(),
  questionIds: z.array(z.string()).max(200).optional(),
});

admin.post("/assistant/answers", async (c) => {
  const db = c.get("db");
  const body = parse(answerSchema, await c.req.json());
  const now = Date.now();
  const id = crypto.randomUUID();
  await db.insert(assistantKnowledge).values({ id, question: body.question, answer: body.answer, keywords: body.keywords ?? "", status: "published", createdAt: now, updatedAt: now });
  if (body.questionIds?.length) {
    await db.update(assistantUnanswered).set({ status: "resolved", knowledgeId: id }).where(and(inArray(assistantUnanswered.id, body.questionIds), eq(assistantUnanswered.status, "open")));
  }
  return ok(c, { id });
});

admin.patch("/assistant/answers/:id", async (c) => {
  const db = c.get("db");
  const body = parse(answerSchema.omit({ questionIds: true }).extend({ status: z.enum(["published", "archived"]) }), await c.req.json());
  await db
    .update(assistantKnowledge)
    .set({ question: body.question, answer: body.answer, keywords: body.keywords ?? "", status: body.status, updatedAt: Date.now() })
    .where(eq(assistantKnowledge.id, c.req.param("id")));
  return ok(c, { id: c.req.param("id") });
});

admin.post("/assistant/questions/dismiss", async (c) => {
  const db = c.get("db");
  const body = parse(z.object({ ids: z.array(z.string()).min(1).max(200) }), await c.req.json());
  await db.update(assistantUnanswered).set({ status: "dismissed" }).where(and(inArray(assistantUnanswered.id, body.ids), eq(assistantUnanswered.status, "open")));
  return ok(c, { dismissed: body.ids.length });
});
