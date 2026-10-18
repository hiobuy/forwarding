import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { formatDocumentMoney, pdfSafe, type DocumentSnapshot } from "../src/domain/invoicing";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.33, 0.38, 0.45);
const LINE = rgb(0.86, 0.88, 0.91);
const RULE = rgb(0.12, 0.14, 0.18);

function brandRgb(hex: string | null | undefined) {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return RULE;
  const n = Number.parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function renderDocumentPdf(snapshot: DocumentSnapshot, logo?: { bytes: Uint8Array; contentType: string } | null, brandColor?: string | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logoImage: PDFImage | null = null;
  if (logo?.bytes.byteLength) {
    try {
      logoImage = logo.contentType.includes("png") ? await pdf.embedPng(logo.bytes) : await pdf.embedJpg(logo.bytes);
    } catch {
      logoImage = null;
    }
  }
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  y = drawHeader(page, font, bold, snapshot, logoImage, y, brandRgb(brandColor));
  y = drawParties(page, font, bold, snapshot, y);
  y = drawMeta(page, font, bold, snapshot, y);
  y = drawLines(page, font, bold, snapshot, y);
  y = drawTotals(page, font, bold, snapshot, y);
  if (snapshot.payment) y = drawPayment(page, font, bold, snapshot, y);
  drawFooter(page, font, snapshot, y);
  page.drawText("1", { x: PAGE_WIDTH - MARGIN - 8, y: 28, size: 8, font, color: MUTED });
  return pdf.save();
}

function drawHeader(page: PDFPage, font: PDFFont, bold: PDFFont, snapshot: DocumentSnapshot, logo: PDFImage | null, y: number, rule: ReturnType<typeof rgb>): number {
  if (logo) {
    const width = 72;
    const height = Math.min(36, (logo.height / logo.width) * width);
    page.drawImage(logo, { x: MARGIN, y: y - height, width, height });
  }
  const title = pdfSafe(snapshot.title, 40);
  const titleWidth = bold.widthOfTextAtSize(title, 16);
  page.drawText(title, { x: PAGE_WIDTH - MARGIN - titleWidth, y: y - 16, size: 16, font: bold, color: INK });
  const number = pdfSafe(snapshot.number, 40);
  const numberWidth = font.widthOfTextAtSize(number, 10);
  page.drawText(number, { x: PAGE_WIDTH - MARGIN - numberWidth, y: y - 32, size: 10, font, color: MUTED });
  page.drawLine({ start: { x: MARGIN, y: y - 48 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 48 }, thickness: 1.25, color: rule });
  return y - 68;
}

function drawParties(page: PDFPage, font: PDFFont, bold: PDFFont, snapshot: DocumentSnapshot, y: number): number {
  const left = drawParty(page, font, bold, "From", snapshot.seller, MARGIN, y);
  const right = drawParty(page, font, bold, "Bill to", snapshot.customer, 320, y);
  return Math.min(left, right) - 8;
}

function drawParty(page: PDFPage, font: PDFFont, bold: PDFFont, label: string, party: DocumentSnapshot["seller"], x: number, y: number): number {
  page.drawText(label.toUpperCase(), { x, y, size: 8, font: bold, color: MUTED });
  let cursor = y - 16;
  page.drawText(pdfSafe(party.name || "—", 80), { x, y: cursor, size: 11, font: bold, color: INK });
  cursor -= 14;
  for (const line of party.lines) {
    page.drawText(pdfSafe(line, 80), { x, y: cursor, size: 9, font, color: INK });
    cursor -= 12;
  }
  if (party.email) {
    page.drawText(pdfSafe(party.email, 80), { x, y: cursor, size: 9, font, color: MUTED });
    cursor -= 12;
  }
  if (party.taxId) {
    page.drawText(pdfSafe(`Tax ID ${party.taxId}`, 80), { x, y: cursor, size: 9, font, color: MUTED });
    cursor -= 12;
  }
  return cursor;
}

function drawMeta(page: PDFPage, font: PDFFont, bold: PDFFont, snapshot: DocumentSnapshot, y: number): number {
  const cells = [
    ["Issue date", snapshot.issueDate],
    ["Currency", snapshot.currency],
    ["Shipment", snapshot.shipmentReference ?? "—"],
    ["Payment", paymentLabel(snapshot)],
  ];
  const width = (PAGE_WIDTH - MARGIN * 2) / cells.length;
  cells.forEach((cell, index) => {
    const x = MARGIN + index * width;
    page.drawText(cell[0].toUpperCase(), { x, y, size: 8, font: bold, color: MUTED });
    page.drawText(pdfSafe(cell[1], 28), { x, y: y - 14, size: 10, font, color: INK });
  });
  return y - 36;
}

function drawLines(page: PDFPage, font: PDFFont, bold: PDFFont, snapshot: DocumentSnapshot, y: number): number {
  page.drawRectangle({ x: MARGIN, y: y - 6, width: PAGE_WIDTH - MARGIN * 2, height: 20, color: rgb(0.96, 0.97, 0.98) });
  page.drawText("DESCRIPTION", { x: MARGIN + 8, y: y, size: 8, font: bold, color: MUTED });
  const amountHeader = "AMOUNT";
  page.drawText(amountHeader, { x: PAGE_WIDTH - MARGIN - 8 - bold.widthOfTextAtSize(amountHeader, 8), y, size: 8, font: bold, color: MUTED });
  let cursor = y - 24;
  const lines = snapshot.lines.length ? snapshot.lines : [{ description: "Shipping service", amountFen: snapshot.subtotalFen }];
  for (const line of lines) {
    page.drawText(pdfSafe(line.description, 72), { x: MARGIN + 8, y: cursor, size: 10, font, color: INK });
    const amount = formatDocumentMoney(line.amountFen, snapshot.currency);
    page.drawText(amount, { x: PAGE_WIDTH - MARGIN - 8 - font.widthOfTextAtSize(amount, 10), y: cursor, size: 10, font, color: INK });
    cursor -= 8;
    page.drawLine({ start: { x: MARGIN, y: cursor }, end: { x: PAGE_WIDTH - MARGIN, y: cursor }, thickness: 0.4, color: LINE });
    cursor -= 16;
  }
  return cursor;
}

function drawTotals(page: PDFPage, font: PDFFont, bold: PDFFont, snapshot: DocumentSnapshot, y: number): number {
  const rows: [string, string, boolean][] = [["Subtotal", formatDocumentMoney(snapshot.subtotalFen, snapshot.currency), false]];
  if (snapshot.discountFen > 0) rows.push(["Discount", formatDocumentMoney(-snapshot.discountFen, snapshot.currency), false]);
  rows.push([snapshot.taxLabel ?? "Tax", snapshot.taxLabel ? formatDocumentMoney(snapshot.taxFen, snapshot.currency) : "Not applied", false]);
  rows.push(["Total", formatDocumentMoney(snapshot.totalFen, snapshot.currency), true]);
  let cursor = y;
  for (const [label, value, strong] of rows) {
    const face = strong ? bold : font;
    const size = strong ? 12 : 10;
    page.drawText(label, { x: 360, y: cursor, size, font: face, color: strong ? INK : MUTED });
    page.drawText(value, { x: PAGE_WIDTH - MARGIN - face.widthOfTextAtSize(value, size), y: cursor, size, font: face, color: INK });
    cursor -= strong ? 22 : 16;
  }
  return cursor - 6;
}

function drawPayment(page: PDFPage, font: PDFFont, bold: PDFFont, snapshot: DocumentSnapshot, y: number): number {
  const payment = snapshot.payment;
  if (!payment) return y;
  page.drawText("PAYMENT", { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  const line = pdfSafe(`${payment.paidAt} · ${payment.method} · ${payment.reference}`, 120);
  page.drawText(line, { x: MARGIN, y: y - 14, size: 10, font, color: INK });
  return y - 36;
}

function drawFooter(page: PDFPage, font: PDFFont, snapshot: DocumentSnapshot, y: number) {
  let cursor = Math.min(y, 168);
  if (snapshot.paymentInstructions) {
    cursor = drawWrapped(page, font, pdfSafe(snapshot.paymentInstructions, 400), MARGIN, cursor, 9, MUTED);
    cursor -= 8;
  }
  if (snapshot.footer) {
    cursor = drawWrapped(page, font, pdfSafe(snapshot.footer, 400), MARGIN, cursor, 9, INK);
    cursor -= 8;
  }
  drawWrapped(page, font, pdfSafe(snapshot.disclaimer, 700), MARGIN, Math.min(cursor, 92), 8, MUTED);
}

function drawWrapped(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, color: ReturnType<typeof rgb>): number {
  const max = PAGE_WIDTH - MARGIN * 2;
  const words = text.split(" ");
  let line = "";
  let cursor = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max) {
      if (line) page.drawText(line, { x, y: cursor, size, font, color });
      cursor -= size + 3;
      line = word;
    } else {
      line = next;
    }
  }
  if (line) page.drawText(line, { x, y: cursor, size, font, color });
  return cursor - size - 3;
}

function paymentLabel(snapshot: DocumentSnapshot): string {
  if (snapshot.paymentStatus === "partially_refunded") return "Partially refunded";
  if (snapshot.paymentStatus === "refunded") return "Refunded";
  if (snapshot.paymentStatus === "partial") return "Partially paid";
  if (snapshot.paymentStatus === "paid") return "Paid";
  return "Unpaid";
}
