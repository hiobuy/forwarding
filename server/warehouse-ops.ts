import { and, eq, inArray } from "drizzle-orm";
import type { CargoAttribute } from "../src/domain/status";
import { customerCurrency } from "./locale";
import type { Database } from "./db/client";
import { charges, packageAttributes, packagePhotos, packages, shipmentPackages, shipments, user } from "./db/schema";
import { snapshotPackedFreight } from "./earnings";
import { AppError } from "./errors";
import { notify } from "./notify";
import { packageRow, shipmentRow } from "./rows";

/**
 * Package and shipment status changes still used by the admin lists.
 * Each change checks the current state first, so the same step cannot be applied twice.
 */

export async function owners(db: Database, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, { id: string; name: string; email: string; memberCode: string }>();
  const rows = await db.select({ id: user.id, name: user.name, email: user.email, memberCode: user.memberCode }).from(user).where(inArray(user.id, unique));
  return new Map(rows.map((row) => [row.id, row]));
}

/** Weight is required at inbound; the sides are optional (many parcels are only weighed). */
export type Measure = { weightGrams: number; lengthMm?: number | null; widthMm?: number | null; heightMm?: number | null };

export async function receivePackage(db: Database, id: string, input: Measure & { cargo?: CargoAttribute[]; binLocation?: string }) {
  const { assertManualWarehouseOpen } = await import("./fulfillment-gate");
  await assertManualWarehouseOpen(db);
  const pkg = await packageRow(db, id);
  if (pkg.packageStatus !== "PENDING") throw new AppError("INVALID_STATE", `${pkg.publicId} was already received.`, 409);
  const now = Date.now();
  await db
    .update(packages)
    .set({
      packageStatus: "RECEIVED",
      weightGrams: input.weightGrams,
      lengthMm: input.lengthMm ?? null,
      widthMm: input.widthMm ?? null,
      heightMm: input.heightMm ?? null,
      binLocation: input.binLocation ?? null,
      receivedAt: now,
      updatedAt: now,
    })
    .where(eq(packages.id, pkg.id));
  if (input.cargo?.length) {
    await db.delete(packageAttributes).where(eq(packageAttributes.packageId, pkg.id));
    await db.insert(packageAttributes).values(input.cargo.map((attribute) => ({ id: crypto.randomUUID(), packageId: pkg.id, attribute })));
  }
  await notify(db, pkg.userId, { type: "PACKAGE_RECEIVED", title: "Package received", body: `${pkg.publicId} arrived at the warehouse and was weighed.`, href: `/app/packages/${pkg.id}` });
  return { id: pkg.id, publicId: pkg.publicId, vasPending: pkg.vasStatus === "REQUESTED" || pkg.vasStatus === "PROCESSING" };
}

export async function packShipment(db: Database, id: string, input: { finalWeightGrams: number; finalLengthMm: number; finalWidthMm: number; finalHeightMm: number; freightFen: number }) {
  const { assertManualWarehouseOpen } = await import("./fulfillment-gate");
  await assertManualWarehouseOpen(db);
  const row = await shipmentRow(db, id);
  if (row.status !== "CONSOLIDATING" && row.status !== "WAITING_FOR_WEIGHT") throw new AppError("INVALID_STATE", `${row.publicId} has already been packed.`, 409);
  const now = Date.now();
  await db.delete(charges).where(and(eq(charges.shipmentId, row.id), eq(charges.type, "FREIGHT")));
  await db.insert(charges).values({ id: crypto.randomUUID(), shipmentId: row.id, type: "FREIGHT", name: "International freight", amountFen: input.freightFen, currency: await customerCurrency(db), status: "DUE" });
  await db
    .update(shipments)
    .set({
      status: "TO_PAY",
      upstreamStatus: "WAIT_PAYMENT",
      canCancel: false,
      finalWeightGrams: input.finalWeightGrams,
      finalLengthMm: input.finalLengthMm,
      finalWidthMm: input.finalWidthMm,
      finalHeightMm: input.finalHeightMm,
      updatedAt: now,
    })
    .where(eq(shipments.id, row.id));
  const links = await db.select().from(shipmentPackages).where(eq(shipmentPackages.shipmentId, row.id));
  if (links.length) {
    // Packed parcels are off the shelf.
    await db.update(packages).set({ binLocation: null, updatedAt: now }).where(inArray(packages.id, links.map((link) => link.packageId)));
  }
  await db.insert(packagePhotos).values({ id: crypto.randomUUID(), packageId: null, shipmentId: row.id, type: "PACKED", label: "Packed carton", createdAt: now });
  await notify(db, row.userId, { type: "PAYMENT", title: "Shipment ready for payment", body: `${row.publicId} is packed. Final freight is ready to pay.`, href: `/app/shipments/${row.id}` });
  await snapshotPackedFreight(db, row.id, input.freightFen);
  return { id: row.id, publicId: row.publicId };
}

export async function dispatchShipment(db: Database, id: string, trackingNumber: string) {
  const { assertManualWarehouseOpen } = await import("./fulfillment-gate");
  await assertManualWarehouseOpen(db);
  const row = await shipmentRow(db, id);
  if (row.status === "TO_PAY") throw new AppError("NOT_PAID", `${row.publicId} isn't paid yet. Hold it.`, 409);
  if (row.status !== "READY_TO_SHIP") throw new AppError("INVALID_STATE", row.status === "IN_TRANSIT" ? `${row.publicId} has already been dispatched.` : `${row.publicId} isn't ready to ship.`, 409);
  const tracking = trackingNumber.trim().toUpperCase();
  const now = Date.now();
  await db.update(shipments).set({ status: "IN_TRANSIT", upstreamStatus: "SHIPPED", trackingNumber: tracking, updatedAt: now }).where(eq(shipments.id, row.id));
  const links = await db.select().from(shipmentPackages).where(eq(shipmentPackages.shipmentId, row.id));
  if (links.length) {
    await db.update(packages).set({ packageStatus: "SHIPPED", updatedAt: now }).where(inArray(packages.id, links.map((link) => link.packageId)));
  }
  await notify(db, row.userId, { type: "SHIPPED", title: "Shipment on its way", body: `${row.publicId} left the warehouse. Tracking ${tracking}.`, href: `/app/shipments/${row.id}` });
  return { id: row.id, publicId: row.publicId, trackingNumber: tracking };
}
