import { channelHasMore, parseChannelCatalog, type SyncedDestination } from "../../../src/domain/freight";
import { AppError } from "../../errors";
import { throwUpstream } from "./upstream";

const CHANNELS = "https://api.hiobuy.com/v1/fulfillment/shipping/channels";

/**
 * Warehouse channel catalog with regions.
 * Returns null when this app has no HioBuy token. page_size max is 50.
 */
export async function fetchHioBuyChannelDestinations(token: string | undefined): Promise<SyncedDestination[] | null> {
  if (!token?.trim()) return null;
  const rows: SyncedDestination[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 20; page += 1) {
    const url = new URL(CHANNELS);
    url.searchParams.set("include", "regions");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", "50");
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json", Language: "zh-CN" },
      });
    } catch {
      throw new AppError("UPSTREAM_TIMEOUT", "HioBuy shipping channels did not respond. Try the sync again.", 504);
    }
    const raw = await response.text();
    throwUpstream(response.status, raw, "HioBuy shipping channels could not be loaded.");
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      throw new AppError("UPSTREAM_ERROR", "HioBuy returned a channel response that was not JSON.", 502);
    }
    for (const row of parseChannelCatalog(payload)) {
      const key = `${row.channelCode}|${row.countryCode}|${row.regionCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    if (!channelHasMore(payload)) break;
  }
  if (rows.length === 0) {
    throw new AppError("UPSTREAM_ERROR", "This HioBuy key returned no shipping channels.", 502);
  }
  return rows;
}

