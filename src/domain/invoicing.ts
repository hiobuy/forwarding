/** Forwarding documents. Amounts are integer cents of the currency on the business record. */

export const DOCUMENT_KINDS = ["proforma", "shipping_invoice", "payment_receipt", "credit_note"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const PAYMENT_STATUSES = ["unpaid", "paid", "partial", "refunded", "partially_refunded"] as const;
export type DocumentPaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type DocumentLine = { description: string; amountFen: number };

export type DocumentParty = {
  name: string;
  lines: string[];
  email: string;
  taxId: string;
};

export type InvoiceProfileChoice = {
  id: string;
  label: string;
  kind: "individual" | "business";
  name: string;
  taxId: string;
  email: string;
  address: string;
  countryRegion: string;
};

export type DocumentPayment = {
  paidAt: string;
  method: string;
  reference: string;
};

/** Frozen at issue time. Later settings and rates do not rewrite this object. */
export type DocumentSnapshot = {
  kind: DocumentKind;
  title: string;
  number: string;
  issueDate: string;
  currency: string;
  seller: DocumentParty;
  customer: DocumentParty;
  shipmentReference: string | null;
  lines: DocumentLine[];
  subtotalFen: number;
  discountFen: number;
  taxFen: number;
  taxLabel: string | null;
  totalFen: number;
  paymentStatus: DocumentPaymentStatus;
  payment: DocumentPayment | null;
  footer: string;
  paymentInstructions: string;
  disclaimer: string;
  /** True only when the operator saved both a tax id and a tax rate. */
  statutoryTaxInvoice: boolean;
  relatedNumber: string | null;
  billingProfileId: string | null;
};

export type InvoicingProfile = {
  businessName: string;
  businessAddress: string;
  countryRegion: string;
  taxId: string;
  contactEmail: string;
  invoicePrefix: string;
  invoiceFooter: string;
  paymentInstructions: string;
  defaultCurrency: string;
  taxRateBps: number;
};

export type ServiceCharge = {
  name: string;
  amountFen: number;
  status: string;
  type: string;
};

const TITLES: Record<DocumentKind, string> = {
  proforma: "Proforma Invoice",
  shipping_invoice: "Shipping Service Invoice",
  payment_receipt: "Payment Receipt",
  credit_note: "Credit Note",
};

const SERIES: Record<DocumentKind, string> = {
  proforma: "PI",
  shipping_invoice: "INV",
  payment_receipt: "RCT",
  credit_note: "CN",
};

export const SERVICE_DISCLAIMER =
  "This document records forwarding and shipping services sold to the customer. It is not a customs commercial invoice for the goods. Tax treatment depends on the seller's local rules. A missing tax id or tax rate means this document is not a statutory tax invoice.";

export function documentTitle(kind: DocumentKind): string {
  return TITLES[kind];
}

export function documentText(value: string, max = 240): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Standard PDF fonts cover WinAnsi. Other characters become a visible placeholder. */
export function pdfSafe(value: string, max = 500): string {
  return documentText(value, max).replace(/[^\x20-\x7E]/g, "?");
}

export function normalizePrefix(prefix: string, fallback: string): string {
  const clean = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return clean.length >= 2 ? clean : fallback;
}

export function seriesPrefix(kind: DocumentKind, invoicePrefix: string): string {
  if (kind === "shipping_invoice") return normalizePrefix(invoicePrefix, "INV");
  return SERIES[kind];
}

export function formatDocumentNumber(prefix: string, year: number, sequence: number): string {
  const clean = normalizePrefix(prefix, "INV");
  const serial = Math.max(1, Math.trunc(sequence));
  return `${clean}-${year}-${String(serial).padStart(4, "0")}`;
}

export function documentFilename(number: string): string {
  const safe = number.replace(/[^A-Za-z0-9._-]/g, "");
  return `${safe || "document"}.pdf`;
}

export function formatDocumentMoney(fen: number, currency: string): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  const negative = fen < 0;
  const abs = Math.abs(Math.trunc(fen));
  const major = Math.trunc(abs / 100);
  const minor = abs % 100;
  const grouped = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const amount = `${grouped}.${minor.toString().padStart(2, "0")}`;
  if (code === "USD") return `${negative ? "-" : ""}$${amount}`;
  return `${negative ? "-" : ""}${code} ${amount}`;
}

/** Tax included in a billed amount. The customer total stays the amount already charged. */
export function taxOn(grossFen: number, taxRateBps: number): number {
  if (taxRateBps <= 0 || grossFen <= 0) return 0;
  const bps = Math.min(10_000, Math.trunc(taxRateBps));
  return Math.round((grossFen * bps) / (10_000 + bps));
}

export function serviceLines(charges: ServiceCharge[]): DocumentLine[] {
  return charges
    .filter((charge) => charge.status === "DUE" || charge.status === "PAID")
    .filter((charge) => charge.type !== "COST" && charge.type !== "HIOBUY_COST")
    .map((charge) => ({ description: documentText(charge.name || "Shipping service", 120) || "Shipping service", amountFen: charge.amountFen }));
}

export function documentAmounts(input: { lines: DocumentLine[]; discountFen: number; taxRateBps: number; claimedTotalFen?: number }): {
  subtotalFen: number;
  discountFen: number;
  taxFen: number;
  totalFen: number;
} {
  const subtotalFen = input.lines.reduce((sum, line) => sum + line.amountFen, 0);
  const discountFen = Math.max(0, Math.min(Math.trunc(input.discountFen), Math.max(0, subtotalFen)));
  const totalFen = subtotalFen - discountFen;
  const taxFen = taxOn(totalFen, input.taxRateBps);
  return { subtotalFen, discountFen, taxFen, totalFen };
}

export function paymentStatusFor(input: { paidFen: number; totalFen: number; refundedFen: number }): DocumentPaymentStatus {
  const paid = Math.max(0, Math.trunc(input.paidFen));
  const refunded = Math.max(0, Math.trunc(input.refundedFen));
  const total = Math.max(0, Math.trunc(input.totalFen));
  if (paid <= 0) return "unpaid";
  if (refunded >= paid) return "refunded";
  if (refunded > 0) return "partially_refunded";
  if (total > 0 && paid < total) return "partial";
  return "paid";
}

/** Proforma is a quote. A caller cannot mark it paid. */
export function statusForKind(kind: DocumentKind, computed: DocumentPaymentStatus): DocumentPaymentStatus {
  if (kind === "proforma") return "unpaid";
  if (kind === "payment_receipt" && computed === "unpaid") return "unpaid";
  return computed;
}

export function canIssueProforma(shipmentStatus: string, charges: ServiceCharge[]): boolean {
  return shipmentStatus === "TO_PAY" && serviceLines(charges).some((line) => line.amountFen > 0);
}

export function canIssueShippingInvoice(shipmentStatus: string, charges: ServiceCharge[]): boolean {
  if (shipmentStatus === "CANCELLED" || shipmentStatus === "CONSOLIDATING" || shipmentStatus === "WAITING_FOR_WEIGHT") return false;
  return serviceLines(charges).length > 0;
}

export function canIssueReceipt(paid: boolean): boolean {
  return paid;
}

export function freightConfirmed(shipmentStatus: string, charges: ServiceCharge[]): boolean {
  return canIssueProforma(shipmentStatus, charges) || canIssueShippingInvoice(shipmentStatus, charges);
}

export function idempotencyKey(input: {
  kind: DocumentKind;
  shipmentId?: string | null;
  paymentId?: string | null;
  walletTransactionId?: string | null;
  refundId?: string | null;
  amountFen?: number;
  revision?: number;
}): string {
  if (input.kind === "proforma") return `proforma:${input.shipmentId}:${input.amountFen ?? 0}`;
  if (input.kind === "shipping_invoice") return `invoice:${input.shipmentId}:rev:${input.revision ?? 0}`;
  if (input.kind === "credit_note") return `credit:${input.refundId}`;
  if (input.walletTransactionId) return `receipt:wallet:${input.walletTransactionId}`;
  return `receipt:payment:${input.paymentId}:shipment:${input.shipmentId ?? "none"}`;
}

export function relationAfterRefund(originalTotalFen: number, refundedFen: number): "none" | "partially_refunded" | "refunded" {
  if (refundedFen <= 0) return "none";
  if (refundedFen >= originalTotalFen && originalTotalFen > 0) return "refunded";
  return "partially_refunded";
}

/** A refund adds a credit note. It does not rewrite the original totals. */
export function creditNoteForRefund(refundFen: number): { subtotalFen: number; discountFen: number; taxFen: number; totalFen: number } {
  const amount = Math.max(0, Math.trunc(refundFen));
  return { subtotalFen: amount, discountFen: 0, taxFen: 0, totalFen: amount };
}

export function taxDisclaimer(taxId: string, taxRateBps: number): string {
  if (!taxId.trim() || taxRateBps <= 0) {
    return "Tax registration or a tax rate is not configured, so this document is not marked as a statutory tax invoice.";
  }
  return "Tax is calculated from the rate saved by the operator. The operator must confirm it matches the rules where they operate.";
}

export function partyFromInvoiceProfile(profile: InvoiceProfileChoice, extraLines: string[] = []): DocumentParty {
  const kindLine = profile.kind === "business" ? "Business" : "Individual";
  return partyFrom({
    name: profile.name,
    lines: [profile.label, kindLine, profile.address, profile.countryRegion, ...extraLines],
    email: profile.email,
    taxId: profile.kind === "business" ? profile.taxId : "",
  });
}

export function partyFrom(input: { name: string; lines: string[]; email?: string; taxId?: string }): DocumentParty {
  return {
    name: documentText(input.name, 120),
    lines: input.lines.map((line) => documentText(line, 160)).filter(Boolean),
    email: documentText(input.email ?? "", 120),
    taxId: documentText(input.taxId ?? "", 40),
  };
}

export function buildSnapshot(input: {
  kind: DocumentKind;
  number: string;
  issueDate: string;
  profile: InvoicingProfile;
  customer: DocumentParty;
  shipmentReference: string | null;
  lines: DocumentLine[];
  discountFen: number;
  paidFen: number;
  refundedFen: number;
  payment: DocumentPayment | null;
  relatedNumber: string | null;
  billingProfileId?: string | null;
  currency?: string;
}): DocumentSnapshot {
  const currency = /^[A-Z]{3}$/.test(input.currency ?? "") ? input.currency! : input.profile.defaultCurrency || "USD";
  const amounts =
    input.kind === "credit_note"
      ? creditNoteForRefund(input.lines.reduce((sum, line) => sum + line.amountFen, 0))
      : documentAmounts({ lines: input.lines, discountFen: input.discountFen, taxRateBps: input.profile.taxRateBps });
  const computed = paymentStatusFor({ paidFen: input.paidFen, totalFen: amounts.totalFen, refundedFen: input.refundedFen });
  const paymentStatus = statusForKind(input.kind, computed);
  const statutory = Boolean(input.profile.taxId.trim()) && input.profile.taxRateBps > 0 && input.kind === "shipping_invoice";
  const seller = partyFrom({
    name: input.profile.businessName,
    lines: [input.profile.businessAddress, input.profile.countryRegion],
    email: input.profile.contactEmail,
    taxId: input.profile.taxId,
  });
  return {
    kind: input.kind,
    title: documentTitle(input.kind),
    number: input.number,
    issueDate: input.issueDate,
    currency,
    seller,
    customer: input.customer,
    shipmentReference: input.shipmentReference ? documentText(input.shipmentReference, 40) : null,
    lines: input.kind === "credit_note" ? input.lines.map((line) => ({ description: documentText(line.description, 120), amountFen: line.amountFen })) : input.lines,
    subtotalFen: amounts.subtotalFen,
    discountFen: amounts.discountFen,
    taxFen: amounts.taxFen,
    taxLabel: amounts.taxFen > 0 ? "Tax included" : null,
    totalFen: amounts.totalFen,
    paymentStatus,
    payment: paymentStatus === "unpaid" ? null : input.payment,
    footer: documentText(input.profile.invoiceFooter, 500),
    paymentInstructions: documentText(input.profile.paymentInstructions, 500),
    disclaimer: `${SERVICE_DISCLAIMER} ${taxDisclaimer(input.profile.taxId, input.profile.taxRateBps)}`,
    statutoryTaxInvoice: statutory,
    relatedNumber: input.relatedNumber,
    billingProfileId: input.billingProfileId ?? null,
  };
}

/** Settings saved later are ignored. The issued snapshot is what gets printed. */
export function keepIssuedSnapshot(snapshot: DocumentSnapshot, _next: InvoicingProfile): DocumentSnapshot {
  return snapshot;
}

export function sampleSnapshot(profile: InvoicingProfile, issueDate: string): DocumentSnapshot {
  const sample: InvoicingProfile = {
    ...profile,
    businessName: profile.businessName.trim() || "Business name",
    businessAddress: profile.businessAddress.trim() || "Business address",
    countryRegion: profile.countryRegion.trim() || "Country",
  };
  return buildSnapshot({
    kind: "shipping_invoice",
    number: "SAMPLE",
    issueDate,
    profile: sample,
    customer: partyFrom({ name: "Sample Customer", lines: ["Member AB12", "Ship to: Sample City"], email: "customer@example.com" }),
    shipmentReference: "SHP-SAMPLE",
    lines: [{ description: "International freight", amountFen: 2500 }],
    discountFen: 0,
    paidFen: 0,
    refundedFen: 0,
    payment: null,
    relatedNumber: null,
    currency: profile.defaultCurrency || "USD",
  });
}

export function paymentMethodLabel(method: string): string {
  if (method === "wallet") return "Wallet";
  if (method === "stripe") return "Card";
  if (method === "bank") return "Bank transfer";
  return documentText(method, 40) || "Payment";
}

export function snapshotOmitsInternalCost(snapshot: DocumentSnapshot): boolean {
  const encoded = JSON.stringify(snapshot).toLowerCase();
  return !encoded.includes("hiobuycost") && !encoded.includes("grossprofit") && !encoded.includes("\"cost\"");
}
