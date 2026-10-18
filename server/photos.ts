import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./db/client";
import { cartons, claims, packagePhotos, packages, shipments } from "./db/schema";
import { AppError } from "./errors";

/**
 * Warehouse photos. The image lives in R2 (binding PHOTOS); the row in package_photos says what it shows.
 * Rows from before real photos have no object key and render as placeholders.
 */

export function photoUrl(row: { id: string; objectKey: string | null; remoteUrl?: string | null }) {
  if (row.remoteUrl) return row.remoteUrl;
  return row.objectKey ? `/api/photos/${row.id}` : null;
}

/** Who may see a photo: admins, or the customer who owns the package / shipment it belongs to. */
export async function readPhoto(bucket: R2Bucket | undefined, db: Database, id: string, viewer: { id: string; isAdmin: boolean }) {
  const row = (await db.select().from(packagePhotos).where(eq(packagePhotos.id, id)))[0];
  if (!row?.objectKey || !bucket) throw new AppError("NOT_FOUND", "Photo not found.", 404);
  if (!viewer.isAdmin) {
    let ownerId: string | null = null;
    if (row.packageId) ownerId = (await db.select({ userId: packages.userId }).from(packages).where(eq(packages.id, row.packageId)))[0]?.userId ?? null;
    let shipmentId = row.shipmentId;
    if (!ownerId && !shipmentId && row.cartonId) shipmentId = (await db.select({ shipmentId: cartons.shipmentId }).from(cartons).where(eq(cartons.id, row.cartonId)))[0]?.shipmentId ?? null;
    if (!ownerId && shipmentId) ownerId = (await db.select({ userId: shipments.userId }).from(shipments).where(eq(shipments.id, shipmentId)))[0]?.userId ?? null;
    // A customer asked to confirm an unclaimed parcel may see its photos.
    if (!ownerId && row.unclaimedId) {
      const asked = await db.select({ userId: claims.userId }).from(claims).where(and(eq(claims.unclaimedId, row.unclaimedId), eq(claims.status, "PENDING")));
      if (asked.some((claim) => claim.userId === viewer.id)) ownerId = viewer.id;
    }
    if (ownerId !== viewer.id) throw new AppError("NOT_FOUND", "Photo not found.", 404);
  }
  const object = await bucket.get(row.objectKey);
  if (!object) throw new AppError("NOT_FOUND", "Photo not found.", 404);
  return object;
}

/** Photos taken of an unclaimed parcel move to the package once a customer claims it. */
export async function movePhotosToPackage(db: Database, unclaimedId: string, packageId: string) {
  const rows = await db.select({ id: packagePhotos.id }).from(packagePhotos).where(eq(packagePhotos.unclaimedId, unclaimedId));
  if (rows.length) await db.update(packagePhotos).set({ packageId }).where(inArray(packagePhotos.id, rows.map((row) => row.id)));
  return rows.length;
}
