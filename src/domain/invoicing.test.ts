import { describe, expect, it } from "vitest";
import { renderDocumentPdf } from "../../server/document-pdf";
import {
  partyFromInvoiceProfile,
  buildSnapshot,
  canIssueProforma,
  canIssueReceipt,
  creditNoteForRefund,
  documentAmounts,
  documentFilename,
  documentText,
  formatDocumentMoney,
  formatDocumentNumber,
  idempotencyKey,
  keepIssuedSnapshot,
  paymentStatusFor,
  relationAfterRefund,
  sampleSnapshot,
  serviceLines,
  snapshotOmitsInternalCost,
  statusForKind,
  taxOn,
  type InvoicingProfile,
} from "./invoicing";

const profile: InvoicingProfile = {
  businessName: "Northwind Forwarding",
  businessAddress: "1 Harbor Road",
  countryRegion: "Singapore",
  taxId: "",
  contactEmail: "billing@northwind.example",
  invoicePrefix: "INV",
  invoiceFooter: "Thank you.",
  paymentInstructions: "Pay from your wallet.",
  defaultCurrency: "USD",
  taxRateBps: 0,
};

const customer = { name: "Ada Lovelace", lines: ["Member M-1"], email: "ada@example.com", taxId: "" };

describe("document numbers and money", () => {
  it("formats a unique zero-padded number from the series", () => {
    expect(formatDocumentNumber("inv", 2026, 1)).toBe("INV-2026-0001");
    expect(formatDocumentNumber("inv", 2026, 2)).not.toBe(formatDocumentNumber("inv", 2026, 1));
  });

  it("names the file from the document number", () => {
    expect(documentFilename("INV-2026-0001")).toBe("INV-2026-0001.pdf");
  });

  it("formats cents without rounding drift", () => {
    expect(formatDocumentMoney(18000, "USD")).toBe("$180.00");
    expect(formatDocumentMoney(5, "EUR")).toBe("EUR 0.05");
  });
});

describe("amounts come from business records", () => {
  it("ignores a claimed total", () => {
    const amounts = documentAmounts({
      lines: [{ description: "International freight", amountFen: 2500 }],
      discountFen: 0,
      taxRateBps: 0,
      claimedTotalFen: 1,
    });
    expect(amounts.totalFen).toBe(2500);
  });

  it("drops internal cost lines", () => {
    const lines = serviceLines([
      { name: "International freight", amountFen: 2500, status: "DUE", type: "FREIGHT" },
      { name: "HioBuy cost", amountFen: 900, status: "DUE", type: "HIOBUY_COST" },
      { name: "Estimate", amountFen: 1000, status: "ESTIMATE", type: "FREIGHT" },
    ]);
    expect(lines).toEqual([{ description: "International freight", amountFen: 2500 }]);
  });

  it("shows configured tax inside the billed amount", () => {
    expect(taxOn(2500, 0)).toBe(0);
    expect(taxOn(2500, 1000)).toBe(227);
    expect(documentAmounts({ lines: [{ description: "International freight", amountFen: 2500 }], discountFen: 0, taxRateBps: 1000 }).totalFen).toBe(2500);
  });
});

describe("payment status", () => {
  it("does not mark an unpaid document paid", () => {
    expect(paymentStatusFor({ paidFen: 0, totalFen: 2500, refundedFen: 0 })).toBe("unpaid");
    expect(statusForKind("proforma", "paid")).toBe("unpaid");
    expect(canIssueProforma("TO_PAY", [{ name: "International freight", amountFen: 2500, status: "DUE", type: "FREIGHT" }])).toBe(true);
    expect(canIssueReceipt(false)).toBe(false);
  });
});

describe("snapshots stay fixed", () => {
  it("keeps the issued seller and total after settings change", () => {
    const issued = buildSnapshot({
      kind: "shipping_invoice",
      number: "INV-2026-0001",
      issueDate: "2026-10-17",
      profile,
      customer,
      shipmentReference: "SHP-1",
      lines: [{ description: "International freight", amountFen: 2500 }],
      discountFen: 0,
      paidFen: 2500,
      refundedFen: 0,
      payment: { paidAt: "2026-10-17", method: "Wallet", reference: "pay_1" },
      relatedNumber: null,
    });
    const next = { ...profile, businessName: "Renamed", taxRateBps: 2000, defaultCurrency: "EUR" };
    const kept = keepIssuedSnapshot(issued, next);
    expect(kept.seller.name).toBe("Northwind Forwarding");
    expect(kept.totalFen).toBe(2500);
    expect(kept.currency).toBe("USD");
    expect(kept.statutoryTaxInvoice).toBe(false);
  });

  it("marks a configured tax invoice only when a tax id and rate exist", () => {
    const issued = buildSnapshot({
      kind: "shipping_invoice",
      number: "INV-2026-0002",
      issueDate: "2026-10-17",
      profile: { ...profile, taxId: "GST-1", taxRateBps: 900 },
      customer,
      shipmentReference: "SHP-1",
      lines: [{ description: "International freight", amountFen: 1000 }],
      discountFen: 0,
      paidFen: 0,
      refundedFen: 0,
      payment: null,
      relatedNumber: null,
    });
    expect(issued.taxFen).toBe(83);
    expect(issued.totalFen).toBe(1000);
    expect(issued.paymentStatus).toBe("unpaid");
    expect(issued.statutoryTaxInvoice).toBe(true);
    expect(issued.disclaimer).toMatch(/operator/);
  });

  it("does not call a receipt a statutory tax invoice when tax settings are empty", () => {
    const receipt = buildSnapshot({
      kind: "payment_receipt",
      number: "RCT-2026-0001",
      issueDate: "2026-10-17",
      profile,
      customer,
      shipmentReference: null,
      lines: [{ description: "Wallet top-up", amountFen: 5000 }],
      discountFen: 0,
      paidFen: 5000,
      refundedFen: 0,
      payment: { paidAt: "2026-10-17", method: "Card", reference: "pi_1" },
      relatedNumber: null,
    });
    expect(receipt.statutoryTaxInvoice).toBe(false);
    expect(receipt.payment?.reference).toBe("pi_1");
    expect(receipt.disclaimer).toMatch(/not a statutory tax invoice/);
  });
});

describe("refunds", () => {
  it("keeps the original total and records a separate credit amount", () => {
    const original = buildSnapshot({
      kind: "shipping_invoice",
      number: "INV-2026-0003",
      issueDate: "2026-10-17",
      profile,
      customer,
      shipmentReference: "SHP-2",
      lines: [{ description: "International freight", amountFen: 4000 }],
      discountFen: 0,
      paidFen: 4000,
      refundedFen: 0,
      payment: { paidAt: "2026-10-17", method: "Wallet", reference: "pay_2" },
      relatedNumber: null,
    });
    const credit = creditNoteForRefund(1500);
    expect(original.totalFen).toBe(4000);
    expect(credit.totalFen).toBe(1500);
    expect(relationAfterRefund(original.totalFen, 1500)).toBe("partially_refunded");
    expect(relationAfterRefund(original.totalFen, 4000)).toBe("refunded");
  });

  it("uses one idempotency key per refund and per payment", () => {
    expect(idempotencyKey({ kind: "credit_note", refundId: "rf_1" })).toBe(idempotencyKey({ kind: "credit_note", refundId: "rf_1" }));
    expect(idempotencyKey({ kind: "payment_receipt", paymentId: "pay_1", shipmentId: "shp_1" })).toBe(
      idempotencyKey({ kind: "payment_receipt", paymentId: "pay_1", shipmentId: "shp_1" }),
    );
  });
});

describe("invoice profiles", () => {
  it("prints the chosen billing name and tax id", () => {
    const party = partyFromInvoiceProfile(
      { id: "p1", label: "Company", kind: "business", name: "Ada Ltd", taxId: "TAX-1", email: "ada@example.com", address: "1 Road", countryRegion: "SG" },
      ["Ship to: Ada"],
    );
    expect(party.name).toBe("Ada Ltd");
    expect(party.taxId).toBe("TAX-1");
    expect(party.lines.join(" ")).toMatch(/Ship to: Ada/);
  });
});

describe("template safety", () => {
  it("strips markup from text that will be drawn on the PDF", () => {
    expect(documentText("<script>alert(1)</script>")).toBe("scriptalert(1)/script");
    expect(documentText("a\u0000b")).not.toMatch(/\u0000/);
  });

  it("renders a printable PDF without treating markup as HTML", async () => {
    const snapshot = sampleSnapshot({ ...profile, businessName: "Northwind <script>" }, "2026-10-17");
    expect(snapshot.seller.name.includes("<")).toBe(false);
    const bytes = await renderDocumentPdf(snapshot);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF")).toBe(true);
    expect(bytes.length).toBeGreaterThan(500);
    expect(text.includes("<script")).toBe(false);
  });

  it("leaves cost and profit out of a customer snapshot", () => {
    const snapshot = sampleSnapshot(profile, "2026-10-17");
    expect(snapshotOmitsInternalCost(snapshot)).toBe(true);
    expect(snapshot.number).toBe("SAMPLE");
  });
});
