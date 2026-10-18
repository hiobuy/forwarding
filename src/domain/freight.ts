/**
 * Customer prices are USD cents.
 * HioBuy costs are CNY fen. Margin is applied in yuan, then converted at the stored rate.
 * Rate is CNY per 1 USD × 10_000, so 7.2000 is 72000.
 * A percent margin is basis points, so 10% is 1000.
 */

export type SellingPolicy = {
  /** Percent of the HioBuy yuan cost, in basis points. 10% is 1000. */
  markupBps: number;
  /** Extra yuan fen added after the percent. Zero means no fixed add-on. */
  markupCnyFen: number;
  cnyPerUsdE4: number;
};

export const DEFAULT_SELLING_POLICY: SellingPolicy = {
  markupBps: 1000,
  markupCnyFen: 0,
  cnyPerUsdE4: 72000,
};

export type SyncedDestination = {
  channelCode: string;
  channelName: string;
  countryCode: string;
  regionCode: string;
  regionName: string;
};

/** Percent and a fixed yuan amount both apply. Either one may be zero. */
export function markedUpCnyFen(costCnyFen: number, policy: SellingPolicy): number {
  const cost = Math.max(0, Math.round(costCnyFen));
  const bps = Math.min(10000, Math.max(0, Math.round(policy.markupBps)));
  const fixed = Math.max(0, Math.round(policy.markupCnyFen));
  return cost + Math.round((cost * bps) / 10000) + fixed;
}

export function customerUsdFen(costCnyFen: number, policy: SellingPolicy): number {
  const rate = Math.round(policy.cnyPerUsdE4);
  if (rate <= 0) return 0;
  return Math.round((markedUpCnyFen(costCnyFen, policy) * 10000) / rate);
}

export function formatCnyFen(fen: number): string {
  const negative = fen < 0;
  const abs = Math.abs(Math.round(fen));
  const yuan = Math.trunc(abs / 100);
  const cents = abs % 100;
  const grouped = yuan.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}¥${grouped}.${cents.toString().padStart(2, "0")}`;
}

export function formatRateE4(e4: number): string {
  const whole = Math.trunc(Math.abs(e4) / 10000);
  const frac = Math.abs(e4) % 10000;
  return `${whole}.${frac.toString().padStart(4, "0")}`;
}

export function formatPercentBps(bps: number): string {
  const whole = Math.trunc(Math.abs(bps) / 100);
  const frac = Math.abs(bps) % 100;
  return frac === 0 ? String(whole) : `${whole}.${frac.toString().padStart(2, "0").replace(/0$/, "")}`;
}

export function parseRateE4(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,4})?$/.test(trimmed)) return null;
  const [whole = "0", frac = ""] = trimmed.split(".");
  const e4 = Number(whole) * 10000 + Number((frac + "0000").slice(0, 4));
  return e4 > 0 ? e4 : null;
}

export function parsePercentBps(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = "0", frac = ""] = trimmed.split(".");
  const bps = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (bps < 0 || bps > 10000) return null;
  return bps;
}

export function yuanToFen(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = "0", frac = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function catalogDestinations(routes: { code: string; name: string; countries: string[] }[]): SyncedDestination[] {
  const rows: SyncedDestination[] = [];
  for (const route of routes) {
    for (const country of route.countries) {
      rows.push({
        channelCode: route.code,
        channelName: route.name,
        countryCode: country,
        regionCode: "*",
        regionName: "All regions",
      });
    }
  }
  return rows;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function channelPageCount(payload: unknown): number {
  return channelList(payload).length;
}

function channelList(payload: unknown): unknown[] {
  const root = asRecord(payload);
  if (!root) return [];
  if (Array.isArray(root.items)) return root.items;
  if (Array.isArray(root.data)) return root.data;
  const data = asRecord(root.data);
  if (data && Array.isArray(data.items)) return data.items;
  if (Array.isArray(root.channels)) return root.channels;
  return [];
}

export function channelHasMore(payload: unknown): boolean {
  const root = asRecord(payload);
  const pagination = asRecord(root?.pagination);
  if (typeof pagination?.has_more === "boolean") return pagination.has_more;
  return channelPageCount(payload) >= 50;
}

/** Pull country and region rows out of a HioBuy channel catalog payload. Unknown shapes yield nothing. */
export function parseChannelCatalog(payload: unknown): SyncedDestination[] {
  const seen = new Set<string>();
  const rows: SyncedDestination[] = [];
  for (const item of channelList(payload)) {
    const channel = asRecord(item);
    if (!channel) continue;
    const channelCode = text(channel.code);
    const channelName = text(channel.name) || channelCode;
    if (!channelCode) continue;
    const regions = Array.isArray(channel.regions) ? channel.regions : [];
    for (const regionValue of regions) {
      const region = asRecord(regionValue);
      if (!region) continue;
      const listed = Array.isArray(region.countries) ? region.countries : [];
      const fromList = listed.map((item) => text(item).toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code));
      const single = (text(region.country_code) || text(region.country)).toUpperCase();
      const countryCodes = fromList.length ? fromList : /^[A-Z]{2}$/.test(single) ? [single] : [];
      const regionCode = text(region.code) || text(region.region_code) || "*";
      const regionName = text(region.name) || text(region.region_name) || regionCode;
      for (const countryCode of countryCodes) {
        const key = `${channelCode}|${countryCode}|${regionCode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ channelCode, channelName, countryCode, regionCode, regionName });
      }
    }
  }
  return rows;
}
