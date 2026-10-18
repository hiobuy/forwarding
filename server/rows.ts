import { eq } from "drizzle-orm";
import type { Database } from "./db/client";
import { packages, shipments } from "./db/schema";
import { AppError } from "./errors";

export async function packageRow(db: Database, id: string) {
  const row = (await db.select().from(packages).where(eq(packages.id, id)))[0];
  if (!row) throw new AppError("NOT_FOUND", "Package not found.", 404);
  return row;
}

export async function shipmentRow(db: Database, id: string) {
  const row = (await db.select().from(shipments).where(eq(shipments.id, id)))[0];
  if (!row) throw new AppError("NOT_FOUND", "Shipment not found.", 404);
  return row;
}
