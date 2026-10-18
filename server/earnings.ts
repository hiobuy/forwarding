import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  applyPayment,
  describeEarning,
  earningsWindow,
  formatEarningsWindow,
  summarizeEarnings,
  type EarningAdjustment,
  type EarningFact,
  type EarningRange,
  type EarningView,
} from "../src/domain/earnings";
import type { Database } from "./db/client";
import { charges, checkouts, checkoutItems, shipmentEarningAdjustments, shipmentEarnings, shipmentMethods } from "./db/schema";
import { shipmentRow } from "./rows";
import { AppError } from "./errors";
import { sellingPolicy } from "./freight";
import { notify } from "./notify";
import { moveWallet } from "./wallet";

type AdjustmentRow = typeof shipmentEarningAdjustments.$inferSelect;
type EarningRow = typeof shipmentEarnings.$inferSelect;

function adjustmentOf(row: AdjustmentRow): EarningAdjustment {
  const kind = row.kind === "refund" || row.kind === "extra_charge" || row.kind === "cost" ? row.kind : "cost";
  return { id: row.id, idempotencyKey: row.idempotencyKey, kind, usdFen: row.usdFen, cnyFen: row.cnyFen, note: row.note, createdAt: row.createdAt };
}

function factOf(row: EarningRow | undefined, adjustments: EarningAdjustment[], paidChargeFen: number | null): EarningFact {
  if (!row) {
    return {
      paidAt: null,
      billedUsdFen: paidChargeFen,
      collectedUsdFen: paidChargeFen,
      hiobuyCostCnyFen: null,
      markupBps: null,
      markupCnyFen: null,
      cnyPerUsdE4: null,
      costConfirmed: false,
      adjustments,
    };
  }
  return {
    paidAt: row.paidAt,
    billedUsdFen: row.billedUsdFen,
    collectedUsdFen: row.collectedUsdFen ?? (row.paidAt == null ? null : paidChargeFen),
    hiobuyCostCnyFen: row.hiobuyCostCnyFen,
    markupBps: row.markupBps,
    markupCnyFen: row.markupCnyFen,
    cnyPerUsdE4: row.cnyPerUsdE4,
    costConfirmed: row.costConfirmed,
    adjustments,
  };
}

/** Manual packing knows the customer price but not the HioBuy cost. The cost stays unknown until HioBuy Pay confirms it. */
export async function snapshotPackedFreight(db: Database, shipmentId: string, billedUsdFen: number) {
  const existing = (await db.select().from(shipmentEarnings).where(eq(shipmentEarnings.shipmentId, shipmentId)))[0];
  if (existing?.paidAt) return;
  const method = (await db.select({ routeCode: shipmentMethods.routeCode }).from(shipmentMethods).where(eq(shipmentMethods.shipmentId, shipmentId)))[0];
  const policy = method ? await sellingPolicy(db) : null;
  const now = Date.now();
  const values = {
    hiobuyCostCnyFen: null,
    markupBps: policy?.markupBps ?? null,
    markupCnyFen: policy?.markupCnyFen ?? null,
    cnyPerUsdE4: policy?.cnyPerUsdE4 ?? null,
    billedUsdFen,
    updatedAt: now,
  };
  if (existing) {
    await db.update(shipmentEarnings).set(values).where(and(eq(shipmentEarnings.shipmentId, shipmentId), isNull(shipmentEarnings.paidAt)));
    return;
  }
  await db.insert(shipmentEarnings).values({ shipmentId, collectedUsdFen: null, costConfirmed: false, paidAt: null, createdAt: now, ...values });
}

/** Record the HioBuy cost after HioBuy Pay. Collected customer freight stays as it was. */
export async function confirmHiobuyCost(db: Database, shipmentId: string, costCnyFen: number) {
  const existing = (await db.select().from(shipmentEarnings).where(eq(shipmentEarnings.shipmentId, shipmentId)))[0];
  const policy = await sellingPolicy(db);
  const now = Date.now();
  const values = { hiobuyCostCnyFen: costCnyFen, markupBps: policy.markupBps, markupCnyFen: policy.markupCnyFen, cnyPerUsdE4: policy.cnyPerUsdE4, costConfirmed: true, updatedAt: now };
  if (!existing) {
    await db.insert(shipmentEarnings).values({ shipmentId, collectedUsdFen: null, billedUsdFen: null, paidAt: null, createdAt: now, ...values });
    return;
  }
  await db.update(shipmentEarnings).set(values).where(eq(shipmentEarnings.shipmentId, shipmentId));
}

/** Freeze the HioBuy payable amount. A paid snapshot is left alone. */
export async function snapshotRemoteFreight(db: Database, shipmentId: string, billedUsdFen: number, costCnyFen: number) {
  const existing = (await db.select().from(shipmentEarnings).where(eq(shipmentEarnings.shipmentId, shipmentId)))[0];
  if (existing?.paidAt) return;
  const policy = await sellingPolicy(db);
  const now = Date.now();
  const values = {
    hiobuyCostCnyFen: costCnyFen,
    markupBps: policy.markupBps,
    markupCnyFen: policy.markupCnyFen,
    cnyPerUsdE4: policy.cnyPerUsdE4,
    billedUsdFen,
    costConfirmed: true,
    updatedAt: now,
  };
  if (existing) {
    await db.update(shipmentEarnings).set(values).where(and(eq(shipmentEarnings.shipmentId, shipmentId), isNull(shipmentEarnings.paidAt)));
    return;
  }
  await db.insert(shipmentEarnings).values({ shipmentId, collectedUsdFen: null, paidAt: null, createdAt: now, ...values });
}

/** Record collected freight for a paid checkout. A second call does not add the amount again. */
export async function recognizeCheckoutPayment(db: Database, checkoutId: string) {
  const checkout = (await db.select().from(checkouts).where(eq(checkouts.id, checkoutId)))[0];
  if (!checkout || checkout.status !== "PAID" || checkout.paidAt == null) return;
  const items = await db.select().from(checkoutItems).where(eq(checkoutItems.checkoutId, checkoutId));
  const shipmentItems = items.filter((item) => item.referenceType === "SHIPMENT");
  if (!shipmentItems.length) return;
  const now = Date.now();
  for (const item of shipmentItems) {
    const collected = item.amountFen;
    const existing = (await db.select().from(shipmentEarnings).where(eq(shipmentEarnings.shipmentId, item.referenceId)))[0];
    if (existing?.paidAt) continue;
    if (!existing) {
      await db.insert(shipmentEarnings).values({
        shipmentId: item.referenceId,
        hiobuyCostCnyFen: null,
        markupBps: null,
        markupCnyFen: null,
        cnyPerUsdE4: null,
        billedUsdFen: item.amountFen,
        collectedUsdFen: collected,
        costConfirmed: false,
        paidAt: checkout.paidAt,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }
    const next = applyPayment(factOf(existing, [], null), collected, checkout.paidAt);
    if (next.paidAt == null) continue;
    await db
      .update(shipmentEarnings)
      .set({ collectedUsdFen: next.collectedUsdFen, paidAt: next.paidAt, updatedAt: now })
      .where(and(eq(shipmentEarnings.shipmentId, item.referenceId), existing.paidAt == null ? isNull(shipmentEarnings.paidAt) : eq(shipmentEarnings.paidAt, existing.paidAt)));
  }
}

async function paidFreightFen(db: Database, shipmentId: string) {
  const rows = await db.select().from(charges).where(and(eq(charges.shipmentId, shipmentId), eq(charges.type, "FREIGHT"), eq(charges.status, "PAID")));
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + row.amountFen, 0);
}

export async function earningViewsFor(db: Database, ids: string[]) {
  const unique = [...new Set(ids)];
  const views = new Map<string, EarningView>();
  if (!unique.length) return views;
  const [rows, adjustmentRows, paidCharges] = await Promise.all([
    db.select().from(shipmentEarnings).where(inArray(shipmentEarnings.shipmentId, unique)),
    db.select().from(shipmentEarningAdjustments).where(inArray(shipmentEarningAdjustments.shipmentId, unique)),
    db.select().from(charges).where(and(inArray(charges.shipmentId, unique), eq(charges.type, "FREIGHT"), eq(charges.status, "PAID"))),
  ]);
  for (const id of unique) {
    const row = rows.find((item) => item.shipmentId === id);
    const adjustments = adjustmentRows.filter((item) => item.shipmentId === id).map(adjustmentOf);
    const paid = paidCharges.filter((item) => item.shipmentId === id).reduce((sum, item) => sum + item.amountFen, 0);
    const paidFen = paidCharges.some((item) => item.shipmentId === id) ? paid : null;
    views.set(id, describeEarning(factOf(row, adjustments, row ? null : paidFen)));
  }
  return views;
}

export function presentEarning(view: EarningView) {
  return {
    status: view.status,
    fullyRefunded: view.fullyRefunded,
    customerChargedUsdFen: view.customerChargedUsdFen,
    hiobuyCostCnyFen: view.hiobuyCostCnyFen,
    hiobuyCostUsdFen: view.hiobuyCostUsdFen,
    grossProfitUsdFen: view.grossProfitUsdFen,
    markupBps: view.markupBps,
    markupCnyFen: view.markupCnyFen,
    cnyPerUsdE4: view.cnyPerUsdE4,
    paidAt: view.paidAt ? new Date(view.paidAt).toISOString() : null,
    adjustments: view.adjustments.map((row) => ({
      id: row.id,
      kind: row.kind,
      usdFen: row.kind === "cost" ? null : row.usdFen,
      cnyFen: row.cnyFen,
      note: row.note,
      createdAt: new Date(row.createdAt).toISOString(),
    })),
  };
}

export async function earningsSummary(db: Database, range: EarningRange, now = Date.now()) {
  const rows = await db.select().from(shipmentEarnings).where(isNotNull(shipmentEarnings.paidAt));
  const ids = rows.map((row) => row.shipmentId);
  const adjustmentRows = ids.length ? await db.select().from(shipmentEarningAdjustments).where(inArray(shipmentEarningAdjustments.shipmentId, ids)) : [];
  const facts = rows.map((row) => factOf(row, adjustmentRows.filter((item) => item.shipmentId === row.shipmentId).map(adjustmentOf), null));
  const summary = summarizeEarnings(facts, range, now);
  const untimed = await db
    .select({ shipmentId: charges.shipmentId })
    .from(charges)
    .where(and(eq(charges.type, "FREIGHT"), eq(charges.status, "PAID")));
  const timed = new Set(ids);
  const untimedShipments = new Set(untimed.map((row) => row.shipmentId).filter((id) => !timed.has(id))).size;
  const window = earningsWindow(range, now);
  return {
    range,
    timeZone: "UTC" as const,
    start: new Date(window.start).toISOString(),
    end: new Date(window.end).toISOString(),
    label: formatEarningsWindow(window.start, window.end),
    ...summary,
    untimedShipments,
  };
}

async function viewFor(db: Database, shipmentId: string) {
  const views = await earningViewsFor(db, [shipmentId]);
  return views.get(shipmentId)!;
}

export async function finalizeEarningCost(db: Database, shipmentId: string) {
  const row = (await db.select().from(shipmentEarnings).where(eq(shipmentEarnings.shipmentId, shipmentId)))[0];
  if (!row?.paidAt) throw new AppError("INVALID_STATE", "Payment has not been confirmed for this shipment.", 409);
  if (row.hiobuyCostCnyFen == null || row.cnyPerUsdE4 == null) throw new AppError("INVALID_STATE", "This shipment has no HioBuy cost snapshot to confirm.", 409);
  const adjustments = await db.select().from(shipmentEarningAdjustments).where(eq(shipmentEarningAdjustments.shipmentId, shipmentId));
  if (adjustments.length) throw new AppError("INVALID_STATE", "Adjusted shipments keep their adjustment history.", 409);
  await db.update(shipmentEarnings).set({ costConfirmed: true, updatedAt: Date.now() }).where(eq(shipmentEarnings.shipmentId, shipmentId));
  return presentEarning(await viewFor(db, shipmentId));
}

export async function recordEarningAdjustment(
  db: Database,
  shipmentId: string,
  input: { kind: "refund" | "extra_charge" | "cost"; usdFen: number; cnyFen: number | null; note: string; idempotencyKey: string },
) {
  const existing = (await db.select().from(shipmentEarningAdjustments).where(and(eq(shipmentEarningAdjustments.shipmentId, shipmentId), eq(shipmentEarningAdjustments.idempotencyKey, input.idempotencyKey))))[0];
  if (existing) {
    if (existing.kind === "refund") {
      const { safeIssueEarningCredit } = await import("./invoicing");
      await safeIssueEarningCredit(db, shipmentId, input.idempotencyKey, input.usdFen);
    }
    return presentEarning(await viewFor(db, shipmentId));
  }
  const shipment = await shipmentRow(db, shipmentId);
  let row = (await db.select().from(shipmentEarnings).where(eq(shipmentEarnings.shipmentId, shipmentId)))[0];
  const now = Date.now();
  if (!row) {
    const paid = await paidFreightFen(db, shipmentId);
    if (paid == null && input.kind !== "cost") throw new AppError("INVALID_STATE", "This shipment has not been paid.", 409);
    await db.insert(shipmentEarnings).values({
      shipmentId,
      hiobuyCostCnyFen: null,
      markupBps: null,
      markupCnyFen: null,
      cnyPerUsdE4: null,
      billedUsdFen: paid,
      collectedUsdFen: paid,
      costConfirmed: false,
      paidAt: null,
      createdAt: now,
      updatedAt: now,
    });
    row = (await db.select().from(shipmentEarnings).where(eq(shipmentEarnings.shipmentId, shipmentId)))[0];
  }
  if (!row) throw new AppError("INVALID_STATE", "Earnings for this shipment could not be saved.", 409);
  const current = await viewFor(db, shipmentId);
  if (input.kind !== "cost" && row.paidAt == null && row.collectedUsdFen == null) {
    throw new AppError("INVALID_STATE", "This shipment has not been paid.", 409);
  }
  if (input.kind === "refund") {
    const revenue = current.revenueUsdFen ?? 0;
    if (input.usdFen <= 0 || input.usdFen > revenue) throw new AppError("VALIDATION_ERROR", "The refund is larger than the freight still collected.");
    await moveWallet(db, { userId: shipment.userId, amountFen: input.usdFen, type: "SHIPMENT_REFUND", referenceType: "EARNING", referenceId: `${shipment.id}:${input.idempotencyKey}`, description: `Freight refund ${shipment.publicId}` });
  }
  if (input.kind === "extra_charge") {
    if (input.usdFen <= 0) throw new AppError("VALIDATION_ERROR", "Enter an extra freight amount above $0.");
    await moveWallet(db, {
      userId: shipment.userId,
      amountFen: -input.usdFen,
      type: "SHIPMENT_ADJUSTMENT",
      referenceType: "EARNING",
      referenceId: `${shipment.id}:${input.idempotencyKey}`,
      description: `Extra freight ${shipment.publicId}`,
      insufficientMessage: "The customer wallet cannot cover this extra freight.",
    });
  }
  if (input.kind === "cost") {
    if (input.cnyFen == null || input.cnyFen < 0) throw new AppError("VALIDATION_ERROR", "Enter the HioBuy cost in yuan.");
    if (row.cnyPerUsdE4 == null) throw new AppError("INVALID_STATE", "This shipment has no saved exchange rate, so a new cost cannot be converted.", 409);
  }
  await db.insert(shipmentEarningAdjustments).values({
    id: crypto.randomUUID(),
    shipmentId,
    kind: input.kind,
    usdFen: input.kind === "cost" ? 0 : input.usdFen,
    cnyFen: input.kind === "cost" ? input.cnyFen : null,
    idempotencyKey: input.idempotencyKey,
    note: input.note,
    createdAt: now,
  });
  if (input.kind === "cost") await db.update(shipmentEarnings).set({ costConfirmed: true, updatedAt: now }).where(eq(shipmentEarnings.shipmentId, shipmentId));
  if (input.kind === "refund") {
    const { safeIssueEarningCredit } = await import("./invoicing");
    await safeIssueEarningCredit(db, shipmentId, input.idempotencyKey, input.usdFen);
  }
  await notify(db, shipment.userId, {
    type: "SHIPMENT",
    title: input.kind === "refund" ? "Freight refunded" : input.kind === "extra_charge" ? "Extra freight collected" : "Shipping cost updated",
    body: `${shipment.publicId}: ${input.note}`,
    href: `/app/shipments/${shipment.id}`,
  });
  return presentEarning(await viewFor(db, shipmentId));
}
