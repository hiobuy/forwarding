/**
 * Shipping gross profit from a shipment's own price snapshot.
 * Current markup and exchange-rate settings are never an input.
 * Amounts are integer cents (USD) or fen (CNY). A missing cost stays null.
 */

export const EARNINGS_TIME_ZONE = "UTC";

export type EarningRange = "today" | "7d" | "30d";

export type EarningAdjustmentKind = "refund" | "extra_charge" | "cost";

export type EarningAdjustment = {
  id: string;
  idempotencyKey: string;
  kind: EarningAdjustmentKind;
  /** Refund and extra charge, in USD cents. Unused for a cost change. */
  usdFen: number;
  /** Absolute replacement HioBuy cost in CNY fen. Only for kind "cost". */
  cnyFen: number | null;
  note: string;
  createdAt: number;
};

export type EarningFact = {
  paidAt: number | null;
  billedUsdFen: number | null;
  collectedUsdFen: number | null;
  hiobuyCostCnyFen: number | null;
  markupBps: number | null;
  markupCnyFen: number | null;
  cnyPerUsdE4: number | null;
  costConfirmed: boolean;
  adjustments: EarningAdjustment[];
};

export type ProfitStatus = "pending" | "provisional" | "finalized" | "adjusted" | "unavailable";

export type EarningView = {
  status: ProfitStatus;
  /** Realized shipping revenue and cost can be added into a period total. */
  included: boolean;
  fullyRefunded: boolean;
  customerChargedUsdFen: number | null;
  hiobuyCostCnyFen: number | null;
  hiobuyCostUsdFen: number | null;
  grossProfitUsdFen: number | null;
  revenueUsdFen: number | null;
  markupBps: number | null;
  markupCnyFen: number | null;
  cnyPerUsdE4: number | null;
  paidAt: number | null;
  adjustments: EarningAdjustment[];
};

export type EarningSummary = {
  revenueUsdFen: number;
  costUsdFen: number;
  grossProfitUsdFen: number;
  paidShipments: number;
  excludedShipments: number;
  grossMarginBps: number | null;
  averageProfitUsdFen: number | null;
};

/** HioBuy yuan cost converted at the shipment's own rate. No markup. */
export function cnyFenToUsdFen(cnyFen: number, cnyPerUsdE4: number): number | null {
  const rate = Math.round(cnyPerUsdE4);
  if (rate <= 0) return null;
  return Math.round((Math.round(cnyFen) * 10000) / rate);
}

/** A repeated payment confirmation must not replace the amount already stored. */
export function applyPayment(fact: EarningFact, collectedUsdFen: number, paidAt: number): EarningFact {
  if (fact.paidAt != null) return fact;
  return { ...fact, collectedUsdFen, paidAt };
}

/** Wallet top-ups, quotes, unpaid bills, and failed charges are not shipping revenue. */
export function countsAsShippingRevenue(source: "top_up" | "quote" | "unpaid" | "failed" | "shipment_payment"): boolean {
  return source === "shipment_payment";
}

export function earningsWindow(range: EarningRange, now: number): { start: number; end: number } {
  const date = new Date(now);
  const startOfToday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysBack = range === "today" ? 0 : range === "7d" ? 6 : 29;
  return { start: startOfToday - daysBack * 24 * 60 * 60 * 1000, end: now };
}

export function formatEarningsWindow(start: number, end: number): string {
  const fmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: EARNINGS_TIME_ZONE });
  const from = fmt.format(start);
  const to = fmt.format(end);
  return from === to ? `${from} UTC` : `${from} – ${to} UTC`;
}

function deduped(adjustments: EarningAdjustment[]): EarningAdjustment[] {
  const seen = new Set<string>();
  return adjustments.filter((row) => {
    if (seen.has(row.idempotencyKey)) return false;
    seen.add(row.idempotencyKey);
    return true;
  });
}

export function describeEarning(fact: EarningFact): EarningView {
  const adjustments = deduped(fact.adjustments);
  const refunded = adjustments.filter((row) => row.kind === "refund").reduce((sum, row) => sum + row.usdFen, 0);
  const extra = adjustments.filter((row) => row.kind === "extra_charge").reduce((sum, row) => sum + row.usdFen, 0);
  const costChange = [...adjustments].reverse().find((row) => row.kind === "cost" && row.cnyFen != null);
  const costCny = costChange?.cnyFen ?? fact.hiobuyCostCnyFen;
  const rate = fact.cnyPerUsdE4;
  const costUsd = costCny != null && rate != null ? cnyFenToUsdFen(costCny, rate) : null;
  const paid = fact.paidAt != null || fact.collectedUsdFen != null;
  const revenue = paid && fact.collectedUsdFen != null ? fact.collectedUsdFen + extra - refunded : null;
  const preview = !paid && fact.billedUsdFen != null && costUsd != null ? fact.billedUsdFen - costUsd : null;
  const profit = revenue != null && costUsd != null ? revenue - costUsd : preview;
  const fullyRefunded = fact.paidAt != null && refunded > 0 && (revenue ?? 0) <= 0;
  let status: ProfitStatus;
  if (!paid) status = "pending";
  else if (profit == null) status = "unavailable";
  else if (adjustments.length > 0) status = "adjusted";
  else if (fact.costConfirmed) status = "finalized";
  else status = "provisional";
  const charged = paid ? revenue : fact.billedUsdFen;
  return {
    status,
    included: fact.paidAt != null && profit != null,
    fullyRefunded,
    customerChargedUsdFen: charged,
    hiobuyCostCnyFen: costCny,
    hiobuyCostUsdFen: costUsd,
    grossProfitUsdFen: profit,
    revenueUsdFen: revenue,
    markupBps: fact.markupBps,
    markupCnyFen: fact.markupCnyFen,
    cnyPerUsdE4: rate,
    paidAt: fact.paidAt,
    adjustments,
  };
}

export function summarizeEarnings(facts: EarningFact[], range: EarningRange, now: number): EarningSummary {
  const window = earningsWindow(range, now);
  let revenueUsdFen = 0;
  let costUsdFen = 0;
  let grossProfitUsdFen = 0;
  let paidShipments = 0;
  let excludedShipments = 0;
  for (const fact of facts) {
    if (fact.paidAt == null || fact.paidAt < window.start || fact.paidAt > window.end) continue;
    const view = describeEarning(fact);
    if (!view.included || view.revenueUsdFen == null || view.hiobuyCostUsdFen == null || view.grossProfitUsdFen == null) {
      excludedShipments += 1;
      continue;
    }
    revenueUsdFen += view.revenueUsdFen;
    costUsdFen += view.hiobuyCostUsdFen;
    grossProfitUsdFen += view.grossProfitUsdFen;
    if (!view.fullyRefunded) paidShipments += 1;
  }
  return {
    revenueUsdFen,
    costUsdFen,
    grossProfitUsdFen,
    paidShipments,
    excludedShipments,
    grossMarginBps: revenueUsdFen === 0 ? null : Math.round((grossProfitUsdFen * 10000) / revenueUsdFen),
    averageProfitUsdFen: paidShipments === 0 ? null : Math.round(grossProfitUsdFen / paidShipments),
  };
}
