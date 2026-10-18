import { and, desc, eq, inArray } from "drizzle-orm";
import {
  buildSnapshot,
  canIssueProforma,
  canIssueReceipt,
  canIssueShippingInvoice,
  creditNoteForRefund,
  documentFilename,
  documentTitle,
  formatDocumentNumber,
  idempotencyKey,
  partyFrom,
  partyFromInvoiceProfile,
  paymentMethodLabel,
  relationAfterRefund,
  sampleSnapshot,
  seriesPrefix,
  serviceLines,
  type DocumentKind,
  type DocumentSnapshot,
  type InvoicingProfile,
} from "../src/domain/invoicing";
import type { Database } from "./db/client";
import { singletonRow } from "./db/singleton";
import {
  billingDocuments,
  charges,
  checkoutItems,
  checkouts,
  documentCounters,
  invoicingSettings,
  payments,
  refundRecords,
  shipmentAddresses,
  shipments,
  user,
  walletTransactions,
} from "./db/schema";
import { invoiceSeller } from "../src/domain/business";
import { readBrandAsset, storedBusiness } from "./business";
import { renderDocumentPdf } from "./document-pdf";
import { AppError } from "./errors";
import { defaultInvoiceProfile, invoiceProfileFor, listInvoiceProfiles } from "./invoice-profiles";

const LOGO_KEY = "invoicing/logo";
const PAID_STATES = ["paid", "disputed", "refunded"];

export type InvoicingSettingsView = InvoicingProfile & { hasLogo: boolean };

export type DocumentView = {
  id: string;
  number: string;
  kind: DocumentKind;
  title: string;
  status: string;
  paymentStatus: string;
  relationStatus: string;
  currency: string;
  totalFen: number;
  issuedAt: string;
  filename: string;
  voidReason: string | null;
  relatedNumber: string | null;
  billToName: string;
};

type BillRow = typeof billingDocuments.$inferSelect;

const emptyProfile: InvoicingProfile = {
  businessName: "",
  businessAddress: "",
  countryRegion: "",
  taxId: "",
  contactEmail: "",
  invoicePrefix: "INV",
  invoiceFooter: "",
  paymentInstructions: "",
  defaultCurrency: "USD",
  taxRateBps: 0,
};

export async function invoicingSettingsView(db: Database): Promise<InvoicingSettingsView & { seller: InvoicingProfile; fromBusiness: boolean }> {
  const row = await settingsRow(db);
  const invoice = profileOf(row);
  const business = await storedBusiness(db);
  return {
    ...invoice,
    hasLogo: Boolean(row.logoObjectKey),
    seller: invoiceSeller(business, invoice),
    fromBusiness: Boolean(business.name.trim() || business.legalName.trim() || business.address.trim() || business.country.trim()),
  };
}

export async function saveInvoicingSettings(db: Database, input: InvoicingProfile): Promise<InvoicingSettingsView> {
  const current = await settingsRow(db);
  await db
    .update(invoicingSettings)
    .set({
      businessName: input.businessName.trim(),
      businessAddress: input.businessAddress.trim(),
      countryRegion: input.countryRegion.trim(),
      taxId: input.taxId.trim(),
      contactEmail: input.contactEmail.trim(),
      invoicePrefix: seriesPrefix("shipping_invoice", input.invoicePrefix),
      invoiceFooter: input.invoiceFooter.trim(),
      paymentInstructions: input.paymentInstructions.trim(),
      defaultCurrency: input.defaultCurrency,
      taxRateBps: input.taxRateBps,
      updatedAt: Date.now(),
    })
    .where(eq(invoicingSettings.id, current.id));
  return invoicingSettingsView(db);
}

export async function saveInvoicingLogo(db: Database, bucket: R2Bucket | undefined, file: File) {
  if (!bucket) throw new AppError("CONFIG", "File storage is not configured.", 500);
  if (file.type !== "image/png" && file.type !== "image/jpeg") throw new AppError("VALIDATION_ERROR", "Upload a PNG or JPEG logo.");
  if (file.size > 512 * 1024) throw new AppError("VALIDATION_ERROR", "Logo must be 512 KB or smaller.");
  await bucket.put(LOGO_KEY, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const current = await settingsRow(db);
  await db.update(invoicingSettings).set({ logoObjectKey: LOGO_KEY, updatedAt: Date.now() }).where(eq(invoicingSettings.id, current.id));
  return { hasLogo: true };
}

export async function clearInvoicingLogo(db: Database, bucket: R2Bucket | undefined) {
  const current = await settingsRow(db);
  if (bucket && current.logoObjectKey) await bucket.delete(current.logoObjectKey);
  await db.update(invoicingSettings).set({ logoObjectKey: null, updatedAt: Date.now() }).where(eq(invoicingSettings.id, current.id));
  return { hasLogo: false };
}

export async function readInvoicingLogo(db: Database, bucket: R2Bucket | undefined) {
  const current = await settingsRow(db);
  if (!bucket || !current.logoObjectKey) return null;
  const object = await bucket.get(current.logoObjectKey);
  if (!object) return null;
  return { bytes: new Uint8Array(await object.arrayBuffer()), contentType: object.httpMetadata?.contentType ?? "image/png" };
}

export async function previewInvoicingPdf(db: Database, bucket: R2Bucket | undefined, profile: InvoicingProfile) {
  const business = await storedBusiness(db);
  const logo = await documentLogo(db, bucket);
  const bytes = await renderDocumentPdf(sampleSnapshot(invoiceSeller(business, profile), isoDate(Date.now())), logo, business.primaryColor);
  return { bytes, filename: "sample-invoice.pdf" };
}

export async function shipmentDocumentState(db: Database, shipmentId: string, ownerId: string | null) {
  const context = await loadShipment(db, shipmentId, ownerId);
  const documents = await documentsForShipment(db, context);
  const seller = await effectiveProfile(db);
  return {
    documents: documents.map(presentDocument),
    capabilities: capabilitiesFor(context),
    sellerReady: Boolean(seller.businessName.trim()),
    profiles: await listInvoiceProfiles(db, context.userId),
  };
}

export async function issueShipmentDocument(db: Database, shipmentId: string, kind: DocumentKind, ownerId: string | null, profileId: string | null) {
  if (kind === "credit_note") throw new AppError("VALIDATION_ERROR", "Credit notes are issued from a refund.");
  const context = await withBilling(db, await loadShipment(db, shipmentId, ownerId), profileId);
  const profile = await effectiveProfile(db);
  requireBusiness(profile);
  const row = await issueFromContext(db, context, profile, kind);
  await refreshRelations(db, context.shipmentId, context.payment?.id ?? null);
  return presentDocument(row);
}

export async function voidUnpaidDocument(db: Database, id: string, reason: string) {
  const row = await requiredDocument(db, id, null);
  if (row.status === "void") return presentDocument(row);
  if (row.kind === "payment_receipt" || row.kind === "credit_note" || row.paymentStatus !== "unpaid") {
    throw new AppError("INVALID_STATE", "Paid documents stay on record. Refunds issue a credit note instead of editing the original.", 409);
  }
  const voidReason = reason.slice(0, 240);
  await db.update(billingDocuments).set({ status: "void", voidedAt: Date.now(), voidReason }).where(eq(billingDocuments.id, row.id));
  return presentDocument({ ...row, status: "void", voidedAt: Date.now(), voidReason });
}

export async function documentPdf(db: Database, bucket: R2Bucket | undefined, id: string, ownerId: string | null) {
  const row = await requiredDocument(db, id, ownerId);
  const logo = await documentLogo(db, bucket);
  const bytes = await renderDocumentPdf(parseSnapshot(row.snapshot), logo, (await storedBusiness(db)).primaryColor);
  return { bytes, filename: documentFilename(row.number) };
}

export async function walletReceiptPdf(db: Database, bucket: R2Bucket | undefined, userId: string, transactionId: string, profileId: string | null) {
  const tx = (await db.select().from(walletTransactions).where(and(eq(walletTransactions.id, transactionId), eq(walletTransactions.userId, userId))))[0];
  if (!tx || tx.type !== "TOP_UP" || tx.amountFen <= 0) throw new AppError("NOT_FOUND", "Receipt not found.", 404);
  const profile = await effectiveProfile(db);
  requireBusiness(profile);
  const key = idempotencyKey({ kind: "payment_receipt", walletTransactionId: tx.id });
  const existing = (await db.select().from(billingDocuments).where(eq(billingDocuments.idempotencyKey, key)))[0];
  const row = existing ?? (await issueWalletReceipt(db, profile, tx, profileId));
  const logo = await documentLogo(db, bucket);
  const bytes = await renderDocumentPdf(parseSnapshot(row.snapshot), logo, (await storedBusiness(db)).primaryColor);
  return { bytes, filename: documentFilename(row.number) };
}

export async function safeIssueCheckoutDocuments(db: Database, checkoutId: string) {
  try {
    await issueCheckoutDocuments(db, checkoutId);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "shipment documents were not issued", detail: error instanceof Error ? error.message : "unknown" }));
  }
}

export async function safeIssueWalletReceipt(db: Database, userId: string, referenceType: string, referenceId: string) {
  try {
    const tx = (
      await db
        .select()
        .from(walletTransactions)
        .where(and(eq(walletTransactions.userId, userId), eq(walletTransactions.referenceType, referenceType), eq(walletTransactions.referenceId, referenceId), eq(walletTransactions.type, "TOP_UP")))
    )[0];
    if (!tx) return;
    const profile = await effectiveProfile(db);
    if (!profile.businessName.trim()) return;
    const key = idempotencyKey({ kind: "payment_receipt", walletTransactionId: tx.id });
    const existing = (await db.select().from(billingDocuments).where(eq(billingDocuments.idempotencyKey, key)))[0];
    if (existing) return;
    await issueWalletReceipt(db, profile, tx, null);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "top-up receipt was not issued", detail: error instanceof Error ? error.message : "unknown" }));
  }
}

export async function safeIssueRefundCredit(db: Database, refundId: string) {
  try {
    await issueRefundCredit(db, refundId);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "credit note was not issued", detail: error instanceof Error ? error.message : "unknown" }));
  }
}

export async function safeIssueEarningCredit(db: Database, shipmentId: string, key: string, amountFen: number) {
  try {
    const profile = await effectiveProfile(db);
    if (!profile.businessName.trim()) return;
    const refundKey = `credit:earning:${shipmentId}:${key}`;
    const existing = (await db.select().from(billingDocuments).where(eq(billingDocuments.idempotencyKey, refundKey)))[0];
    if (existing) return;
    const shipment = (await db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0];
    if (!shipment) return;
    const account = (await db.select().from(user).where(eq(user.id, shipment.userId)))[0];
    const invoice = (
      await db
        .select()
        .from(billingDocuments)
        .where(and(eq(billingDocuments.shipmentId, shipmentId), eq(billingDocuments.kind, "shipping_invoice"), eq(billingDocuments.status, "active")))
    )[0];
    const amounts = creditNoteForRefund(amountFen);
    await insertSnapshot(db, profile, {
      kind: "credit_note",
      userId: shipment.userId,
      shipmentId,
      paymentId: null,
      walletTransactionId: null,
      refundId: null,
      relatedDocumentId: invoice?.id ?? null,
      idempotencyKey: refundKey,
      lines: [{ description: "Refund of shipping services", amountFen: amounts.totalFen }],
      paidFen: amounts.totalFen,
      refundedFen: 0,
      customer: customerParty(account, null),
      shipmentReference: shipment.publicId,
      payment: { paidAt: isoDate(Date.now()), method: "Wallet", reference: documentTextRef(key) },
      relatedNumber: invoice?.number ?? null,
      currency: "USD",
    });
    await refreshRelations(db, shipmentId, null);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "refund voucher was not issued", detail: error instanceof Error ? error.message : "unknown" }));
  }
}

async function issueCheckoutDocuments(db: Database, checkoutId: string) {
  const checkout = (await db.select().from(checkouts).where(eq(checkouts.id, checkoutId)))[0];
  if (!checkout || checkout.status !== "PAID") return;
  const items = await db.select().from(checkoutItems).where(and(eq(checkoutItems.checkoutId, checkoutId), eq(checkoutItems.referenceType, "SHIPMENT")));
  const profile = await effectiveProfile(db);
  if (!profile.businessName.trim()) return;
  for (const item of items) {
    const loaded = await loadShipment(db, item.referenceId, null);
    const preferred = await defaultInvoiceProfile(db, loaded.userId);
    const context = await withBilling(db, loaded, preferred?.id ?? null);
    if (canIssueShippingInvoice(context.status, context.chargeRows)) await issueFromContext(db, context, profile, "shipping_invoice");
    if (context.payment && PAID_STATES.includes(context.payment.status)) await issueFromContext(db, context, profile, "payment_receipt");
  }
}

async function issueRefundCredit(db: Database, refundId: string) {
  const refund = (await db.select().from(refundRecords).where(eq(refundRecords.id, refundId)))[0];
  if (!refund || refund.status !== "refunded") return;
  const key = idempotencyKey({ kind: "credit_note", refundId });
  const existing = (await db.select().from(billingDocuments).where(eq(billingDocuments.idempotencyKey, key)))[0];
  if (existing) return;
  const payment = (await db.select().from(payments).where(eq(payments.id, refund.paymentId)))[0];
  if (!payment) return;
  const profile = await effectiveProfile(db);
  if (!profile.businessName.trim()) return;
  const account = (await db.select().from(user).where(eq(user.id, payment.userId)))[0];
  const shipment = await singleShipment(db, payment.checkoutId);
  const invoice = shipment
    ? (
        await db
          .select()
          .from(billingDocuments)
          .where(and(eq(billingDocuments.shipmentId, shipment.id), eq(billingDocuments.kind, "shipping_invoice"), eq(billingDocuments.status, "active")))
      )[0]
    : undefined;
  const amounts = creditNoteForRefund(refund.amountFen);
  await insertSnapshot(db, profile, {
    kind: "credit_note",
    userId: payment.userId,
    shipmentId: shipment?.id ?? null,
    paymentId: payment.id,
    walletTransactionId: null,
    refundId,
    relatedDocumentId: invoice?.id ?? null,
    idempotencyKey: key,
    lines: [{ description: shipment ? `Refund of shipping services ${shipment.publicId}` : "Refund of wallet top-up", amountFen: amounts.totalFen }],
    paidFen: amounts.totalFen,
    refundedFen: 0,
    customer: customerParty(account, null),
    shipmentReference: shipment?.publicId ?? null,
    payment: { paidAt: isoDate(refund.createdAt), method: paymentMethodLabel(refund.method), reference: refund.stripeRefundId || refund.id },
    relatedNumber: invoice?.number ?? null,
    currency: payment.currency || "USD",
  });
  await refreshRelations(db, shipment?.id ?? null, payment.id);
}

async function issueWalletReceipt(db: Database, profile: InvoicingProfile, tx: typeof walletTransactions.$inferSelect, profileId: string | null) {
  const account = (await db.select().from(user).where(eq(user.id, tx.userId)))[0];
  const chosen = profileId ? await invoiceProfileFor(db, tx.userId, profileId) : await defaultInvoiceProfile(db, tx.userId);
  const method = tx.referenceType === "STRIPE" ? "Card" : tx.referenceType === "BANK_TRANSFER" ? "Bank transfer" : "Wallet";
  const linkedPayment = tx.referenceType === "STRIPE" && tx.referenceId ? (await db.select().from(payments).where(eq(payments.id, tx.referenceId)))[0] : undefined;
  const reference = linkedPayment?.stripePaymentIntentId || tx.referenceId || tx.id;
  return insertSnapshot(db, profile, {
    kind: "payment_receipt",
    userId: tx.userId,
    shipmentId: null,
    paymentId: tx.referenceType === "STRIPE" ? tx.referenceId : null,
    walletTransactionId: tx.id,
    refundId: null,
    relatedDocumentId: null,
    idempotencyKey: idempotencyKey({ kind: "payment_receipt", walletTransactionId: tx.id }),
    lines: [{ description: "Wallet top-up", amountFen: tx.amountFen }],
    paidFen: tx.amountFen,
    refundedFen: 0,
    customer: chosen ? partyFromInvoiceProfile(chosen) : customerParty(account, null),
    billingProfileId: chosen?.id ?? null,
    shipmentReference: null,
    payment: { paidAt: isoDate(tx.createdAt), method, reference },
    relatedNumber: null,
    currency: tx.currency || profile.defaultCurrency,
  });
}

type ShipmentContext = {
  shipmentId: string;
  userId: string;
  publicId: string;
  status: string;
  chargeRows: { name: string; amountFen: number; status: string; type: string; currency: string }[];
  payment: { id: string; status: string; method: string; paidAt: number | null; currency: string; reference: string } | null;
  customer: ReturnType<typeof customerParty>;
  billingProfileId: string | null;
};

async function issueFromContext(db: Database, context: ShipmentContext, profile: InvoicingProfile, kind: DocumentKind) {
  const lines = serviceLines(context.chargeRows);
  if (kind === "proforma" && !canIssueProforma(context.status, context.chargeRows)) {
    throw new AppError("INVALID_STATE", "A proforma invoice is available after freight is confirmed and before it is paid.", 409);
  }
  if (kind === "shipping_invoice" && !canIssueShippingInvoice(context.status, context.chargeRows)) {
    throw new AppError("INVALID_STATE", "A shipping invoice is available after freight is confirmed.", 409);
  }
  const paid = Boolean(context.payment && PAID_STATES.includes(context.payment.status));
  if (kind === "payment_receipt" && !canIssueReceipt(paid)) {
    throw new AppError("INVALID_STATE", "A receipt is available after the payment is confirmed.", 409);
  }
  if (kind === "proforma") {
    const key = `${idempotencyKey({ kind, shipmentId: context.shipmentId, amountFen: lines.reduce((sum, line) => sum + line.amountFen, 0) })}:bill:${context.billingProfileId ?? "account"}`;
    const active = await activeOf(db, context.shipmentId, kind);
    if (active?.idempotencyKey === key) return active;
    if (active) await markVoid(db, active, "Billing details or freight changed before payment.");
    return insertSnapshot(db, profile, draft(context, profile, kind, key, lines, false));
  }
  const active = await activeOf(db, context.shipmentId, kind);
  if (active && (active.paymentStatus !== "unpaid" || (parseSnapshot(active.snapshot).billingProfileId ?? null) === context.billingProfileId)) return active;
  if (active) await markVoid(db, active, "Billing details changed before payment.");
  const prior = await db.select().from(billingDocuments).where(and(eq(billingDocuments.shipmentId, context.shipmentId), eq(billingDocuments.kind, kind)));
  const key = kind === "payment_receipt" ? idempotencyKey({ kind, shipmentId: context.shipmentId, paymentId: context.payment?.id }) : idempotencyKey({ kind, shipmentId: context.shipmentId, revision: prior.length });
  const existing = (await db.select().from(billingDocuments).where(eq(billingDocuments.idempotencyKey, key)))[0];
  if (existing) return existing;
  return insertSnapshot(db, profile, draft(context, profile, kind, key, lines, paid));
}

function draft(context: ShipmentContext, profile: InvoicingProfile, kind: DocumentKind, key: string, lines: { description: string; amountFen: number }[], paid: boolean) {
  const billed = lines.reduce((sum, line) => sum + line.amountFen, 0);
  return {
    kind,
    userId: context.userId,
    shipmentId: context.shipmentId,
    paymentId: context.payment?.id ?? null,
    walletTransactionId: null,
    refundId: null,
    relatedDocumentId: null,
    idempotencyKey: key,
    lines,
    paidFen: paid ? billed : 0,
    refundedFen: 0,
    customer: context.customer,
    shipmentReference: context.publicId,
    payment: kind === "payment_receipt" && context.payment ? { paidAt: isoDate(context.payment.paidAt ?? Date.now()), method: paymentMethodLabel(context.payment.method), reference: context.payment.reference } : null,
    relatedNumber: null,
    billingProfileId: context.billingProfileId,
    currency: context.chargeRows[0]?.currency || context.payment?.currency || profile.defaultCurrency,
  };
}

async function insertSnapshot(
  db: Database,
  profile: InvoicingProfile,
  input: {
    kind: DocumentKind;
    userId: string;
    shipmentId: string | null;
    paymentId: string | null;
    walletTransactionId: string | null;
    refundId: string | null;
    relatedDocumentId: string | null;
    idempotencyKey: string;
    lines: { description: string; amountFen: number }[];
    paidFen: number;
    refundedFen: number;
    customer: ReturnType<typeof customerParty>;
    shipmentReference: string | null;
    payment: { paidAt: string; method: string; reference: string } | null;
    relatedNumber: string | null;
    billingProfileId?: string | null;
    currency: string;
  },
) {
  const prefix = seriesPrefix(input.kind, profile.invoicePrefix);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sequence = await takeNumber(db, prefix);
    const number = formatDocumentNumber(prefix, new Date().getUTCFullYear(), sequence);
    const snapshot = buildSnapshot({
      kind: input.kind,
      number,
      issueDate: isoDate(Date.now()),
      profile,
      customer: input.customer,
      shipmentReference: input.shipmentReference,
      lines: input.lines,
      discountFen: 0,
      paidFen: input.paidFen,
      refundedFen: input.refundedFen,
      payment: input.payment,
      relatedNumber: input.relatedNumber,
      billingProfileId: input.billingProfileId ?? null,
      currency: input.currency,
    });
    const row: BillRow = {
      id: crypto.randomUUID(),
      number,
      kind: input.kind,
      status: "active",
      userId: input.userId,
      shipmentId: input.shipmentId,
      paymentId: input.paymentId,
      walletTransactionId: input.walletTransactionId,
      refundId: input.refundId,
      relatedDocumentId: input.relatedDocumentId,
      currency: snapshot.currency,
      subtotalFen: snapshot.subtotalFen,
      taxFen: snapshot.taxFen,
      totalFen: snapshot.totalFen,
      paymentStatus: snapshot.paymentStatus,
      relationStatus: "none",
      snapshot: JSON.stringify(snapshot),
      idempotencyKey: input.idempotencyKey,
      issuedAt: Date.now(),
      voidedAt: null,
      voidReason: null,
    };
    try {
      await db.insert(billingDocuments).values(row);
      return row;
    } catch (error) {
      const again = (await db.select().from(billingDocuments).where(eq(billingDocuments.idempotencyKey, input.idempotencyKey)))[0];
      if (again) return again;
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("UNIQUE") || attempt === 2) throw error;
    }
  }
  throw new AppError("CONFLICT", "Could not issue the document. Try again.", 409);
}

async function loadShipment(db: Database, shipmentId: string, ownerId: string | null): Promise<ShipmentContext> {
  const shipment = (await db.select().from(shipments).where(eq(shipments.id, shipmentId)))[0];
  if (!shipment || (ownerId && shipment.userId !== ownerId)) throw new AppError("NOT_FOUND", "Shipment not found.", 404);
  const account = (await db.select().from(user).where(eq(user.id, shipment.userId)))[0];
  const address = (await db.select().from(shipmentAddresses).where(eq(shipmentAddresses.shipmentId, shipmentId)))[0];
  const chargeRows = await db.select().from(charges).where(eq(charges.shipmentId, shipmentId));
  const links = await db.select().from(checkoutItems).where(and(eq(checkoutItems.referenceType, "SHIPMENT"), eq(checkoutItems.referenceId, shipmentId)));
  let payment: ShipmentContext["payment"] = null;
  if (links.length) {
    const checkoutRows = await db.select().from(checkouts).where(inArray(checkouts.id, links.map((link) => link.checkoutId)));
    const paidCheckout = checkoutRows.filter((row) => row.status === "PAID").sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0))[0];
    if (paidCheckout) {
      const paymentRow = (await db.select().from(payments).where(and(eq(payments.checkoutId, paidCheckout.id), inArray(payments.status, PAID_STATES))).orderBy(desc(payments.paidAt)))[0];
      if (paymentRow) {
        payment = {
          id: paymentRow.id,
          status: paymentRow.status,
          method: paymentRow.method,
          paidAt: paymentRow.paidAt,
          currency: paymentRow.currency,
          reference: paymentRow.stripePaymentIntentId || paymentRow.idempotencyKey || paymentRow.id,
        };
      }
    }
  }
  return {
    shipmentId,
    userId: shipment.userId,
    publicId: shipment.publicId,
    status: shipment.status,
    chargeRows,
    payment,
    customer: customerParty(account, address ?? null),
    billingProfileId: null,
  };
}

async function withBilling(db: Database, context: ShipmentContext, profileId: string | null): Promise<ShipmentContext> {
  const chosen = await invoiceProfileFor(db, context.userId, profileId);
  if (!chosen) return context;
  const extras = context.customer.lines.filter((line) => line.startsWith("Ship to") || line.startsWith("Member"));
  return { ...context, billingProfileId: chosen.id, customer: partyFromInvoiceProfile(chosen, extras) };
}

async function documentsForShipment(db: Database, context: ShipmentContext) {
  const direct = await db.select().from(billingDocuments).where(eq(billingDocuments.shipmentId, context.shipmentId)).orderBy(desc(billingDocuments.issuedAt));
  if (!context.payment) return direct;
  const linked = await db.select().from(billingDocuments).where(eq(billingDocuments.paymentId, context.payment.id));
  const seen = new Set(direct.map((row) => row.id));
  return [...direct, ...linked.filter((row) => !seen.has(row.id))].sort((a, b) => b.issuedAt - a.issuedAt);
}

function capabilitiesFor(context: ShipmentContext) {
  const paid = Boolean(context.payment && PAID_STATES.includes(context.payment.status));
  return {
    proforma: canIssueProforma(context.status, context.chargeRows),
    shippingInvoice: canIssueShippingInvoice(context.status, context.chargeRows),
    receipt: canIssueReceipt(paid),
  };
}

async function refreshRelations(db: Database, shipmentId: string | null, paymentId: string | null) {
  const rows = shipmentId ? await db.select().from(billingDocuments).where(eq(billingDocuments.shipmentId, shipmentId)) : [];
  const extra = paymentId ? await db.select().from(billingDocuments).where(eq(billingDocuments.paymentId, paymentId)) : [];
  const all = [...rows];
  for (const row of extra) if (!all.some((item) => item.id === row.id)) all.push(row);
  const credited = all.filter((row) => row.kind === "credit_note" && row.status === "active").reduce((sum, row) => sum + row.totalFen, 0);
  for (const row of all) {
    if (row.kind !== "shipping_invoice" && row.kind !== "payment_receipt") continue;
    const relation = relationAfterRefund(row.totalFen, credited);
    if (relation !== row.relationStatus) await db.update(billingDocuments).set({ relationStatus: relation }).where(eq(billingDocuments.id, row.id));
  }
}

async function activeOf(db: Database, shipmentId: string, kind: DocumentKind) {
  return (await db.select().from(billingDocuments).where(and(eq(billingDocuments.shipmentId, shipmentId), eq(billingDocuments.kind, kind), eq(billingDocuments.status, "active"))))[0];
}

async function markVoid(db: Database, row: BillRow, reason: string) {
  await db.update(billingDocuments).set({ status: "void", voidedAt: Date.now(), voidReason: reason }).where(eq(billingDocuments.id, row.id));
}

async function singleShipment(db: Database, checkoutId: string | null) {
  if (!checkoutId) return null;
  const items = await db.select().from(checkoutItems).where(and(eq(checkoutItems.checkoutId, checkoutId), eq(checkoutItems.referenceType, "SHIPMENT")));
  if (items.length !== 1) return null;
  return (await db.select().from(shipments).where(eq(shipments.id, items[0]!.referenceId)))[0] ?? null;
}

async function requiredDocument(db: Database, id: string, ownerId: string | null) {
  const row = (await db.select().from(billingDocuments).where(eq(billingDocuments.id, id)))[0];
  if (!row || (ownerId && row.userId !== ownerId)) throw new AppError("NOT_FOUND", "Document not found.", 404);
  return row;
}

function settingsRow(db: Database) {
  return singletonRow(db, invoicingSettings, { ...emptyProfile, logoObjectKey: null });
}

function profileOf(row: typeof invoicingSettings.$inferSelect): InvoicingProfile {
  return {
    businessName: row.businessName,
    businessAddress: row.businessAddress,
    countryRegion: row.countryRegion,
    taxId: row.taxId,
    contactEmail: row.contactEmail,
    invoicePrefix: row.invoicePrefix,
    invoiceFooter: row.invoiceFooter,
    paymentInstructions: row.paymentInstructions,
    defaultCurrency: row.defaultCurrency,
    taxRateBps: row.taxRateBps,
  };
}

function requireBusiness(profile: InvoicingProfile) {
  if (!profile.businessName.trim()) throw new AppError("INVALID_STATE", "Add a business name under Settings, Business, before issuing a document.", 409);
}

async function effectiveProfile(db: Database) {
  const row = await settingsRow(db);
  return invoiceSeller(await storedBusiness(db), profileOf(row));
}

async function documentLogo(db: Database, bucket: R2Bucket | undefined) {
  const brand = await readBrandAsset(db, bucket, "primary");
  if (brand && (brand.contentType === "image/png" || brand.contentType === "image/jpeg")) return brand;
  return readInvoicingLogo(db, bucket);
}

async function takeNumber(db: Database, series: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = (await db.select().from(documentCounters).where(eq(documentCounters.series, series)))[0];
    if (!row) {
      try {
        await db.insert(documentCounters).values({ series, nextNumber: 2 });
        return 1;
      } catch {
        continue;
      }
    }
    const updated = await db
      .update(documentCounters)
      .set({ nextNumber: row.nextNumber + 1 })
      .where(and(eq(documentCounters.series, series), eq(documentCounters.nextNumber, row.nextNumber)))
      .returning({ nextNumber: documentCounters.nextNumber });
    if (updated.length) return row.nextNumber;
  }
  throw new AppError("CONFLICT", "Could not assign a document number. Try again.", 409);
}

function customerParty(
  account: { name: string; email: string; memberCode: string } | undefined,
  address: { name: string; addressLine1: string; addressLine2: string | null; city: string; state: string; postalCode: string; countryCode: string } | null,
) {
  const lines = [`Member ${account?.memberCode ?? ""}`.trim()];
  if (address) {
    lines.push(`Ship to: ${address.name}`);
    lines.push([address.addressLine1, address.addressLine2].filter(Boolean).join(" "));
    lines.push(`${address.city}, ${address.state} ${address.postalCode} ${address.countryCode}`);
  }
  return partyFrom({ name: account?.name ?? "Customer", lines, email: account?.email ?? "" });
}

function presentDocument(row: BillRow): DocumentView {
  let relatedNumber: string | null = null;
  let billToName = "";
  try {
    const snapshot = JSON.parse(row.snapshot) as DocumentSnapshot;
    relatedNumber = snapshot.relatedNumber ?? null;
    billToName = snapshot.customer?.name ?? "";
  } catch {
    relatedNumber = null;
  }
  return {
    id: row.id,
    number: row.number,
    kind: row.kind as DocumentKind,
    title: documentTitle(row.kind as DocumentKind),
    status: row.status,
    paymentStatus: row.paymentStatus,
    relationStatus: row.relationStatus,
    currency: row.currency,
    totalFen: row.totalFen,
    issuedAt: new Date(row.issuedAt).toISOString(),
    filename: documentFilename(row.number),
    voidReason: row.voidReason,
    relatedNumber,
    billToName,
  };
}

function parseSnapshot(raw: string): DocumentSnapshot {
  const parsed = JSON.parse(raw) as DocumentSnapshot;
  return {
    ...parsed,
    seller: { ...parsed.seller, lines: parsed.seller.lines ?? [] },
    customer: { ...parsed.customer, lines: parsed.customer.lines ?? [] },
    lines: parsed.lines ?? [],
    billingProfileId: parsed.billingProfileId ?? null,
  };
}

export function pdfResponse(bytes: Uint8Array, filename: string, inline = false) {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replaceAll('"', "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function isoDate(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function documentTextRef(value: string) {
  return value.slice(0, 80);
}
