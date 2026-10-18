import { pickWarehouseLocation, type SyncedWarehouse } from "../../../src/domain/warehouse-location";
import { AppError } from "../../errors";
import { throwUpstream } from "./upstream";

export async function probeHioBuyKey(token: string | undefined): Promise<void> {
  if (!token?.trim()) throw new AppError("VALIDATION_ERROR", "Enter an API key first.");
  let response: Response;
  try {
    response = await fetch("https://api.hiobuy.com/v1/fulfillment/locations", {
      headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json" },
    });
  } catch {
    throw new AppError("UPSTREAM_TIMEOUT", "HioBuy did not respond. Try the test again.", 504);
  }
  const raw = await response.text();
  throwUpstream(response.status, raw, "HioBuy rejected this API key. Check that warehouse fulfillment is enabled for it.");
}
export async function fetchHioBuyWarehouse(token: string | undefined): Promise<SyncedWarehouse | null> {
  if (!token?.trim()) return null;
  let response: Response;
  try {
    response = await fetch("https://api.hiobuy.com/v1/fulfillment/locations", {
      headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json" },
    });
  } catch {
    throw new AppError("UPSTREAM_TIMEOUT", "HioBuy warehouse addresses did not respond. Try the sync again.", 504);
  }
  const raw = await response.text();
  throwUpstream(response.status, raw, "HioBuy warehouse addresses could not be loaded.");
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new AppError("UPSTREAM_ERROR", "HioBuy returned a warehouse response that was not JSON.", 502);
  }
  const location = pickWarehouseLocation(payload);
  if (!location) throw new AppError("UPSTREAM_ERROR", "This HioBuy key returned no warehouse address.", 502);
  return location;
}

