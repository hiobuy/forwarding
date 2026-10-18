import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { z } from "zod";
import { createAuth, type WorkerBindings } from "./auth";
import { createDb, type Database } from "./db/client";
import {
  cancelShipment,
  confirmClaim,
  createCheckout,
  createPrealerts,
  createShipment,
  createShippingQuote,
  deleteAddress,
  devMailbox,
  getCheckout,
  getDashboard,
  deletePendingPackage,
  getPackage,
  getPreferences,
  getShipment,
  getWallet,
  getWarehouse,
  listAddresses,
  listClaims,
  listNotifications,
  listPackages,
  listShipments,
  listTransactions,
  markNotificationsRead,
  navCounts,
  payCheckout,
  rejectClaim,
  resolveException,
  saveAddress,
  setDefaultAddress,
  updatePreferences,
  updateProfile,
} from "./data";
import { admin } from "./admin";
import { demoCalculatorOptions, demoChannel, publicDemoEstimate } from "../src/domain/demo";
import { demo, demoEnabled, githubRepoUrl } from "./demo";
import { acceptInvite, activeStaffRole, adminLinkVisible, previewInvite } from "./staff";
import { calculatorOptions, channelDetail, estimateShipping, parseCalculatorInput } from "./calculator";
import { AppError, logEvent, newRequestId } from "./errors";
import { allowQuoteAttempt } from "./quote-limit";
import { readPhoto } from "./photos";
import { drainEmailQueue, emailDeliveryConfigured } from "./email/mailer";
import { listOpenDestinations } from "./freight";
import { createBankTransfer, createShipmentCheckoutSession, createTopupCheckoutSession, handleStripeWebhook, listMyTransfers, paymentOptions, readTransferProof, stripeSessionStatus } from "./payments";
import { ensureAccountRows } from "./account";

type AppEnv = {
  Bindings: WorkerBindings;
  Variables: {
    requestId: string;
    db: Database;
    auth: Awaited<ReturnType<typeof createAuth>>;
    user: { id: string; name: string; email: string; memberCode: string; phone: string | null; country: string | null };
  };
};

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  const requestId = newRequestId();
  c.set("requestId", requestId);
  if (!c.env.BETTER_AUTH_SECRET) {
    return c.json({ error: { code: "CONFIG", message: "Authentication is not configured." }, requestId }, 500);
  }
  const db = createDb(c.env.DB);
  c.set("db", db);
  c.set("auth", await createAuth(c.env, db, c.req.raw));
  await next();
  c.header("x-request-id", requestId);
  c.executionCtx.waitUntil(drainEmailQueue(db, c.env).catch(() => undefined));
  c.executionCtx.waitUntil(
    import("./fulfillment-sync")
      .then(({ processDueFulfillment }) => processDueFulfillment(db, c.env, 3))
      .catch(() => undefined),
  );
});

app.onError((error, c) => {
  const requestId = c.get("requestId");
  if (error instanceof AppError) {
    return c.json(
      { error: { code: error.code, message: error.message, details: error.details ?? null }, requestId },
      error.status as 400,
    );
  }
  logEvent({ level: "error", requestId, message: error instanceof Error ? error.message : "unknown" });
  return c.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." }, requestId }, 500);
});

app.all("/api/auth/*", (c) => c.get("auth").handler(c.req.raw));

app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth") || c.req.path.startsWith("/api/dev") || c.req.path.startsWith("/api/team") || c.req.path === "/api/health" || c.req.path === "/api/branding" || c.req.path.startsWith("/api/branding/") || c.req.path.startsWith("/api/shipping/calculator") || c.req.path === "/api/payments/stripe/webhook" || c.req.path === "/api/webhooks/hiobuy" || c.req.path === "/api/demo/status" || c.req.path === "/api/security/public" || c.req.path === "/api/account/email/confirm") {
    await next();
    return;
  }
  const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new AppError("UNAUTHENTICATED", "Please sign in.", 401);
  const record = session.user as AppEnv["Variables"]["user"];
  if (!record.memberCode) throw new AppError("UNAUTHENTICATED", "Please sign in.", 401);
  await ensureAccountRows(c.get("db"), record.id);
  c.set("user", {
    id: record.id,
    name: record.name,
    email: record.email,
    memberCode: record.memberCode,
    phone: record.phone ?? null,
    country: record.country ?? null,
  });
  await next();
});

function ok<T>(c: { json: (body: unknown, status?: 200) => Response; get: (key: "requestId") => string }, data: T) {
  return c.json({ data, requestId: c.get("requestId") });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", result.error.issues[0]?.message ?? "Invalid request.");
  }
  return result.data;
}

const addressSchema = z.object({
  id: z.string().optional(),
  firstName: z.string().trim().min(1, "First name is required").max(40),
  lastName: z.string().trim().min(1, "Last name is required").max(40),
  email: z.string().trim().email("Enter a valid email.").max(120).optional().or(z.literal("")),
  company: z.string().trim().max(80).optional().or(z.literal("")),
  phoneCode: z.string().trim().regex(/^\+\d{1,4}$/, "Choose a country calling code."),
  phone: z.string().trim().min(5, "Phone is required").max(20),
  countryCode: z.string().trim().length(2),
  regionCode: z.string().trim().min(1, "Choose a region.").max(64),
  state: z.string().trim().min(1, "State is required").max(80),
  city: z.string().trim().min(1, "City is required").max(80),
  district: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().min(3, "Postal code is required").max(16),
  addressLine1: z.string().trim().min(1, "Address is required").max(160),
  addressLine2: z.string().trim().max(160).optional(),
  isDefault: z.boolean().optional(),
});

app.get("/api/health", (c) => ok(c, { ok: true }));

app.get("/api/branding", async (c) => {
  const { publicBrand } = await import("./business");
  const { resolveSiteMode } = await import("../src/domain/site");
  return ok(c, { ...(await publicBrand(c.get("db"), c.env)), siteMode: resolveSiteMode(c.env.PUBLIC_SITE_MODE), githubUrl: githubRepoUrl(c.env) });
});

app.get("/api/branding/assets/:kind", async (c) => {
  const { readBrandAsset } = await import("./business");
  const asset = await readBrandAsset(c.get("db"), c.env.PHOTOS, c.req.param("kind"));
  if (!asset) throw new AppError("NOT_FOUND", "That image is not set.", 404);
  const headers: Record<string, string> = {
    "Content-Type": asset.contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=3600",
  };
  if (asset.contentType === "image/svg+xml") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return new Response(asset.bytes, { headers });
});

app.get("/api/dev/mailbox", async (c) => {
  if (c.env.ENVIRONMENT === "production") throw new AppError("NOT_FOUND", "Not found.", 404);
  const email = c.req.query("email")?.trim().toLowerCase();
  if (!email) throw new AppError("VALIDATION_ERROR", "Email is required.");
  return ok(c, await devMailbox(c.get("db"), email));
});

app.get("/api/security/public", async (c) => {
  const { publicSecurity } = await import("./platform");
  return ok(c, await publicSecurity(c.get("db"), c.env));
});

app.get("/api/me", async (c) => {
  const user = c.get("user");
  const isAdmin = await adminLinkVisible(c.get("db"), user.id, user.email, c.env.ADMIN_EMAILS);
  const { accountSecurityView } = await import("./email-change");
  const { publicSecurity } = await import("./platform");
  const security = await publicSecurity(c.get("db"), c.env);
  return ok(c, { ...user, isAdmin, demoMode: demoEnabled(c.env) && !isAdmin, preferences: await getPreferences(c.get("db"), user.id), emailDeliveryConfigured: await emailDeliveryConfigured(c.get("db"), c.env), ...(await accountSecurityView(c.get("db"), user.id)), googleSignIn: security.google.enabled });
});

app.patch("/api/me", async (c) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(80),
      phone: z.string().trim().max(30).nullable(),
      country: z.string().trim().max(2).nullable(),
    }),
    await c.req.json(),
  );
  await updateProfile(c.get("db"), c.get("user").id, body);
  return ok(c, { ...c.get("user"), name: body.name, phone: body.phone, country: body.country });
});

app.patch("/api/me/preferences", async (c) => {
  const body = parse(
    z.object({
      emailEnabled: z.boolean(),
      packageReceived: z.boolean(),
      actionRequired: z.boolean(),
      vasCompleted: z.boolean(),
      paymentDue: z.boolean(),
      shipmentShipped: z.boolean(),
      shipmentDelivered: z.boolean(),
    }),
    await c.req.json(),
  );
  return ok(c, await updatePreferences(c.get("db"), c.get("user").id, body));
});

app.post("/api/me/email/challenge", async (c) => {
  const { sendCurrentEmailCode } = await import("./email-change");
  return ok(c, await sendCurrentEmailCode(c.get("db"), c.env, c.get("user").id, new URL(c.req.url).origin));
});
app.post("/api/me/email", async (c) => {
  const body = parse(z.object({ email: z.string().trim().email().max(200), password: z.string().max(200).optional().default(""), code: z.string().max(20).optional().default("") }), await c.req.json());
  const { requestEmailChange } = await import("./email-change");
  return ok(c, await requestEmailChange(c.get("db"), c.env, c.get("user").id, new URL(c.req.url).origin, body));
});
app.post("/api/me/email/resend", async (c) => {
  const { resendEmailChange } = await import("./email-change");
  return ok(c, await resendEmailChange(c.get("db"), c.env, c.get("user").id, new URL(c.req.url).origin));
});
app.post("/api/me/email/cancel", async (c) => {
  const { cancelEmailChange } = await import("./email-change");
  return ok(c, await cancelEmailChange(c.get("db"), c.get("user").id));
});
app.post("/api/me/google/unlink", async (c) => {
  const body = parse(z.object({ password: z.string().min(8).max(200) }), await c.req.json());
  const { unlinkGoogle } = await import("./email-change");
  return ok(c, await unlinkGoogle(c.get("db"), c.get("user").id, body.password));
});
app.post("/api/account/email/confirm", async (c) => {
  const body = parse(z.object({ token: z.string().trim().min(20).max(200) }), await c.req.json());
  const { confirmEmailChange } = await import("./email-change");
  return ok(c, await confirmEmailChange(c.get("db"), c.env, body.token));
});

app.get("/api/nav", async (c) => ok(c, await navCounts(c.get("db"), c.get("user").id)));
app.get("/api/dashboard", async (c) => ok(c, await getDashboard(c.get("db"), c.get("user"))));
app.get("/api/warehouse", async (c) => ok(c, await getWarehouse(c.get("db"), c.get("user"))));
app.get("/api/notifications", async (c) => ok(c, await listNotifications(c.get("db"), c.get("user").id)));
app.post("/api/notifications/read", async (c) => ok(c, await markNotificationsRead(c.get("db"), c.get("user").id)));

app.get("/api/packages", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize") ?? 20) || 20));
  return ok(c, await listPackages(c.get("db"), c.get("user").id, c.req.query("status") ?? "all", c.req.query("q") ?? "", page, pageSize));
});

app.get("/api/packages/:id", async (c) => ok(c, await getPackage(c.get("db"), c.get("user").id, c.req.param("id"), c.env.HIOBUY_API_TOKEN)));
app.delete("/api/packages/:id", async (c) => {
  const { id, publicId } = await deletePendingPackage(c.get("db"), c.env, c.req.param("id"), c.get("user").id);
  return ok(c, { id, publicId });
});

const prealertItem = z.object({
  courier: z.string().trim().min(1, "Courier is required").max(40),
  trackingNumber: z.string().trim().min(5, "Tracking number is required").max(40),
  productName: z.string().trim().max(120).optional(),
  quantity: z.number().int().positive().max(999).optional(),
  declaredValueFen: z.number().int().nonnegative().optional(),
  platform: z.enum(["1688", "Taobao", "JD", "Pinduoduo", "Other"]).optional(),
  notes: z.string().trim().max(500).optional(),
});

app.post("/api/packages/prealert", async (c) => {
  const body = parse(
    z.object({
      items: z.array(prealertItem).min(1, "Enter at least one tracking number.").max(30, "You can pre-alert up to 30 tracking numbers at once."),
    }),
    await c.req.json(),
  );
  return ok(c, await createPrealerts(c.get("db"), c.get("user").id, body.items));
});

app.post("/api/packages/:id/exceptions", async (c) => {
  const body = parse(z.object({ action: z.enum(["ACCEPT", "INSPECTION", "RETURN", "DISPOSAL", "SUPPORT"]) }), await c.req.json());
  return ok(c, await resolveException(c.get("db"), c.get("user").id, c.req.param("id"), body.action));
});

app.get("/api/claims", async (c) => ok(c, await listClaims(c.get("db"), c.get("user").id)));
app.post("/api/claims/:id/confirm", async (c) => ok(c, await confirmClaim(c.get("db"), c.get("user").id, c.req.param("id"))));
app.post("/api/claims/:id/reject", async (c) => ok(c, await rejectClaim(c.get("db"), c.get("user").id, c.req.param("id"))));

app.get("/api/destinations", async (c) => ok(c, await listOpenDestinations(c.get("db"))));
app.get("/api/addresses", async (c) => ok(c, await listAddresses(c.get("db"), c.get("user").id)));
app.post("/api/addresses", async (c) => ok(c, await saveAddress(c.get("db"), c.get("user").id, parse(addressSchema, await c.req.json()))));
app.patch("/api/addresses/:id", async (c) => ok(c, await saveAddress(c.get("db"), c.get("user").id, { ...parse(addressSchema, await c.req.json()), id: c.req.param("id") })));
app.delete("/api/addresses/:id", async (c) => ok(c, await deleteAddress(c.get("db"), c.get("user").id, c.req.param("id"))));
app.post("/api/addresses/:id/default", async (c) => ok(c, await setDefaultAddress(c.get("db"), c.get("user").id, c.req.param("id"))));

app.get("/api/shipping/calculator/options", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowQuoteAttempt(`options:${ip}`, 60, 10 * 60 * 1000)) throw new AppError("RATE_LIMITED", "Too many quote requests. Wait a moment and try again.", 429);
  if (demoEnabled(c.env)) return ok(c, { ...demoCalculatorOptions(), demo: true });
  return ok(c, await calculatorOptions(c.get("db"), c.env.HIOBUY_API_TOKEN));
});

app.post("/api/shipping/calculator", async (c) => {
  await limitPublicQuote(c);
  const input = parseCalculatorInput(await c.req.json());
  if (demoEnabled(c.env)) return ok(c, publicDemoEstimate(input));
  return ok(c, await estimateShipping(c.get("db"), c.env.HIOBUY_API_TOKEN, input, "public"));
});

app.get("/api/shipping/calculator/channel", async (c) => {
  await limitPublicQuote(c);
  const code = c.req.query("code") ?? "";
  const country = (c.req.query("country") ?? "").toUpperCase();
  if (demoEnabled(c.env)) return ok(c, demoChannel(code, country));
  return ok(c, await channelDetail(c.get("db"), c.env.HIOBUY_API_TOKEN, code, country, "public"));
});

app.post("/api/shipping/quotes", async (c) => {
  const body = parse(z.object({ packageIds: z.array(z.string()).min(1), addressId: z.string().min(1) }), await c.req.json());
  return ok(c, await createShippingQuote(c.get("db"), c.get("user").id, body.packageIds, body.addressId, c.env.HIOBUY_API_TOKEN));
});

app.get("/api/shipments", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize") ?? 20) || 20));
  return ok(c, await listShipments(c.get("db"), c.get("user").id, c.req.query("status") ?? "all", c.req.query("q") ?? "", page, pageSize));
});

app.post("/api/shipments", async (c) => {
  const body = parse(
    z.object({
      packageIds: z.array(z.string()).min(1),
      addressId: z.string().min(1),
      quoteId: z.string().min(1),
      routeCode: z.string().min(1),
      packingInstruction: z.enum([
        "Remove unnecessary seller packaging",
        "Keep original seller packaging",
        "Reinforce carton",
        "Other instructions",
      ]),
      packingNote: z.string().trim().max(300).optional(),
    }),
    await c.req.json(),
  );
  return ok(c, await createShipment(c.get("db"), c.get("user").id, body, c.req.header("Idempotency-Key") ?? null, c.env.HIOBUY_API_TOKEN));
});

app.get("/api/shipments/:id/documents", async (c) => {
  const { shipmentDocumentState } = await import("./invoicing");
  return ok(c, await shipmentDocumentState(c.get("db"), c.req.param("id"), c.get("user").id));
});
app.post("/api/shipments/:id/documents", async (c) => {
  const body = parse(z.object({ kind: z.enum(["proforma", "shipping_invoice", "payment_receipt"]), profileId: z.string().min(1).nullable().optional() }), await c.req.json());
  const { issueShipmentDocument } = await import("./invoicing");
  return ok(c, await issueShipmentDocument(c.get("db"), c.req.param("id"), body.kind, c.get("user").id, body.profileId ?? null));
});
app.get("/api/documents/:id/pdf", async (c) => {
  const { documentPdf, pdfResponse } = await import("./invoicing");
  const file = await documentPdf(c.get("db"), c.env.PHOTOS, c.req.param("id"), c.get("user").id);
  return pdfResponse(file.bytes, file.filename, c.req.query("inline") === "1");
});
app.get("/api/wallet/transactions/:id/receipt", async (c) => {
  const { pdfResponse, walletReceiptPdf } = await import("./invoicing");
  const file = await walletReceiptPdf(c.get("db"), c.env.PHOTOS, c.get("user").id, c.req.param("id"), c.req.query("profileId") || null);
  return pdfResponse(file.bytes, file.filename);
});

const invoiceProfileSchema = z.object({
  label: z.string().trim().min(1, "Add a label.").max(40),
  kind: z.enum(["individual", "business"]),
  name: z.string().trim().min(1, "Add the name to print.").max(120),
  taxId: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().max(120).refine((value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Enter a valid email."),
  address: z.string().trim().max(240).optional().default(""),
  countryRegion: z.string().trim().max(80).optional().default(""),
  isDefault: z.boolean().optional(),
});

app.get("/api/invoice-profiles", async (c) => {
  const { listInvoiceProfiles } = await import("./invoice-profiles");
  return ok(c, await listInvoiceProfiles(c.get("db"), c.get("user").id));
});
app.post("/api/invoice-profiles", async (c) => {
  const { saveInvoiceProfile } = await import("./invoice-profiles");
  return ok(c, await saveInvoiceProfile(c.get("db"), c.get("user").id, parse(invoiceProfileSchema, await c.req.json())));
});
app.patch("/api/invoice-profiles/:id", async (c) => {
  const { saveInvoiceProfile } = await import("./invoice-profiles");
  return ok(c, await saveInvoiceProfile(c.get("db"), c.get("user").id, parse(invoiceProfileSchema, await c.req.json()), c.req.param("id")));
});
app.delete("/api/invoice-profiles/:id", async (c) => {
  const { deleteInvoiceProfile } = await import("./invoice-profiles");
  return ok(c, await deleteInvoiceProfile(c.get("db"), c.get("user").id, c.req.param("id")));
});
app.post("/api/invoice-profiles/:id/default", async (c) => {
  const { makeDefaultInvoiceProfile } = await import("./invoice-profiles");
  return ok(c, await makeDefaultInvoiceProfile(c.get("db"), c.get("user").id, c.req.param("id")));
});

app.get("/api/shipments/:id/tracking", async (c) => {
  const { carrierTracking } = await import("./fulfillment-sync");
  return ok(c, await carrierTracking(c.get("db"), c.env, c.req.param("id"), c.get("user").id));
});
app.get("/api/shipments/:id", async (c) => ok(c, await getShipment(c.get("db"), c.get("user").id, c.req.param("id"), c.env.HIOBUY_API_TOKEN)));
app.post("/api/shipments/:id/cancel", async (c) => ok(c, await cancelShipment(c.get("db"), c.get("user").id, c.req.param("id"))));

app.post("/api/checkout", async (c) => {
  const body = parse(z.object({ shipmentIds: z.array(z.string()).min(1) }), await c.req.json());
  return ok(c, await createCheckout(c.get("db"), c.get("user").id, body.shipmentIds));
});
app.get("/api/checkout/:id", async (c) => ok(c, await getCheckout(c.get("db"), c.get("user").id, c.req.param("id"))));
app.post("/api/checkout/:id/pay", async (c) => ok(c, await payCheckout(c.get("db"), c.get("user").id, c.req.param("id"), c.req.header("Idempotency-Key") ?? null)));

app.get("/api/wallet", async (c) => ok(c, await getWallet(c.get("db"), c.get("user").id)));
app.get("/api/wallet/transactions", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  return ok(c, await listTransactions(c.get("db"), c.get("user").id, c.req.query("type") ?? "all", page, 20));
});
app.get("/api/payments/options", async (c) => ok(c, await paymentOptions(c.get("db"))));
app.get("/api/payments/stripe/session", async (c) => ok(c, await stripeSessionStatus(c.get("db"), c.get("user").id, c.req.query("session_id") ?? "")));
app.post("/api/payments/stripe/webhook", async (c) => {
  const raw = await c.req.text();
  return ok(c, await handleStripeWebhook(c.get("db"), c.env, raw, c.req.header("stripe-signature")));
});

app.post("/api/webhooks/hiobuy", async (c) => {
  const raw = await c.req.text();
  const { handleHiobuyWebhook } = await import("./fulfillment-sync");
  const result = await handleHiobuyWebhook(c.get("db"), c.env, raw, c.req.header("HioBuy-Signature") ?? null);
  return c.json({ ok: result.status === 200 }, result.status);
});
app.post("/api/checkout/:id/stripe", async (c) => ok(c, await createShipmentCheckoutSession(c.get("db"), c.env, c.get("user").id, c.req.param("id"), new URL(c.req.url).origin)));
app.post("/api/wallet/top-up/stripe", async (c) => {
  const body = parse(z.object({ amountFen: z.number().int().positive() }), await c.req.json());
  return ok(c, await createTopupCheckoutSession(c.get("db"), c.env, c.get("user").id, body.amountFen, new URL(c.req.url).origin));
});
app.post("/api/wallet/bank-transfers", async (c) => {
  const form = await c.req.parseBody();
  const amountFen = Number(form.amountFen);
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  if (!Number.isInteger(amountFen) || amountFen <= 0) throw new AppError("VALIDATION_ERROR", "Enter an amount greater than $0.");
  const proof = form.proof instanceof File ? form.proof : null;
  return ok(
    c,
    await createBankTransfer(
      c.get("db"),
      c.env.PHOTOS,
      c.get("user").id,
      { amountFen, reference: text(form.reference, 80), transferDate: text(form.transferDate, 20), proofNote: text(form.proofNote, 500) },
      proof,
    ),
  );
});
app.get("/api/wallet/bank-transfers", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  return ok(c, await listMyTransfers(c.get("db"), c.get("user").id, c.req.query("status") ?? "all", page, 10));
});
app.get("/api/wallet/bank-transfers/:id/proof", async (c) => {
  const object = await readTransferProof(c.get("db"), c.env.PHOTOS, c.req.param("id"), { id: c.get("user").id, isAdmin: false });
  return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=3600" } });
});
app.get("/api/photos/:id", async (c) => {
  const viewer = c.get("user");
  const object = await readPhoto(c.env.PHOTOS, c.get("db"), c.req.param("id"), { id: viewer.id, isAdmin: Boolean(await activeStaffRole(c.get("db"), viewer.id)) });
  return new Response(object.body, {
    headers: { "content-type": object.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=86400", etag: object.httpEtag },
  });
});

app.get("/api/team/invites/:token", async (c) => ok(c, await previewInvite(c.get("db"), c.req.param("token"))));
app.post("/api/team/accept", async (c) => {
  const body = parse(
    z.object({
      token: z.string().trim().min(20).max(200),
      name: z.string().trim().max(80).optional(),
      password: z.string().max(200).optional(),
    }),
    await c.req.json(),
  );
  const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  return ok(c, await acceptInvite(c.get("db"), c.get("auth"), { ...body, sessionEmail: session?.user.email ?? null }));
});

app.route("/api/admin", admin);
app.route("/api/demo", demo);

async function limitPublicQuote(c: { req: { header: (name: string) => string | undefined; raw: Request }; get: (key: "auth") => AppEnv["Variables"]["auth"] }) {
  let key = `ip:${c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local"}`;
  let limit = 15;
  const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers }).catch(() => null);
  const id = session?.user?.id;
  if (id) {
    key = `user:${id}`;
    limit = 40;
  }
  if (!allowQuoteAttempt(key, limit, 10 * 60 * 1000)) throw new AppError("RATE_LIMITED", "Too many quote requests. Wait a moment and try again.", 429);
}

app.all("/api/*", () => {
  throw new AppError("NOT_FOUND", "Not found.", 404);
});

export { ForwardingAssistant } from "./assistant";

export default {
  async fetch(request: Request, env: WorkerBindings, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/agents/")) {
      const db = createDb(env.DB);
      const auth = await createAuth(env, db, request);
      const session = await auth.api.getSession({ headers: request.headers });
      const userId = session?.user.id;
      const memberCode = session?.user.memberCode;
      const instance = decodeURIComponent(url.pathname.split("/").filter(Boolean)[2] ?? "");
      if (!userId || !memberCode || instance !== userId) {
        return new Response("Unauthorized", { status: 401 });
      }
      const { customerAiEnabled } = await import("./platform");
      if (!(await customerAiEnabled(db, env))) return new Response("The assistant is turned off.", { status: 403 });
      return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledEvent, env: WorkerBindings, ctx: ExecutionContext) {
    const db = createDb(env.DB);
    ctx.waitUntil(
      import("./fulfillment-sync")
        .then(({ processDueFulfillment }) => processDueFulfillment(db, env, 8))
        .catch(() => undefined),
    );
  },
};
