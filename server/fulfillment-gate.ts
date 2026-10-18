import type { Database } from "./db/client";
import { AppError } from "./errors";
import { fulfillmentConnected } from "./freight";

/** Connected merchants leave receiving, packing, and dispatch to HioBuy. */
export async function assertManualWarehouseOpen(db: Database) {
  if (await fulfillmentConnected(db)) {
    throw new AppError("HIOBUY_CONNECTED", "HioBuy warehouse records receiving, packing, and dispatch. Use Sync Center to follow the result.", 409);
  }
}
