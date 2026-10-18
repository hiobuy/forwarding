import { formatCnyFen } from "./freight";
import { formatTransitTime, type LiveQuote } from "./live-quote";

export type ChannelService = { name: string; mode: string; description: string | null; price: string | null };
export type ChannelRateRow = { label: string; range: string; amount: string };
export type ChannelRateCard = { region: string; rows: ChannelRateRow[] };

export type ChannelDetail = {
  code: string;
  name: string;
  description: string | null;
  delivery: string[];
  range: string | null;
  volumetric: string | null;
  regions: { name: string; eta: string | null }[];
  restrictions: string[];
  services: ChannelService[];
  rates: ChannelRateCard[] | null;
};

/** Customer views omit HioBuy rate cards. Admin views keep them as reference CNY amounts. */
export function presentChannelDetail(payload: unknown, countryCode: string, audience: "public" | "admin"): ChannelDetail | null {
  const channel = asRecord(payload);
  if (!channel) return null;
  const code = text(channel.code);
  if (!code) return null;
  const billing = asRecord(channel.billing);
  const regions = regionsFor(channel.regions, countryCode);
  const restrictions = restrictionsOf(channel);
  const services = servicesOf(channel, audience);
  return {
    code,
    name: text(channel.name) || code,
    description: text(channel.description) || null,
    delivery: deliveryOf(channel),
    range: rangeOf(billing),
    volumetric: volumetricOf(billing),
    regions,
    restrictions,
    services,
    rates: audience === "admin" ? rateCardsOf(channel, regions) : null,
  };
}

function regionsFor(value: unknown, countryCode: string): { name: string; eta: string | null; code: string }[] {
  if (!Array.isArray(value)) return [];
  const wanted = countryCode.toUpperCase();
  const rows = value.flatMap((item) => {
    const region = asRecord(item);
    if (!region) return [];
    const countries = Array.isArray(region.countries) ? region.countries.map((code) => text(code).toUpperCase()) : [];
    if (countries.length && !countries.includes(wanted)) return [];
    const code = text(region.code);
    return [{ code, name: text(region.name) || code || "Region", eta: formatTransitTime(region.reference_transit_time as LiveQuote["transit_time"]) }];
  });
  return rows;
}

function deliveryOf(channel: Record<string, unknown>): string[] {
  const capabilities = asRecord(channel.capabilities);
  const methods = capabilities && Array.isArray(capabilities.delivery_methods) ? capabilities.delivery_methods : [];
  return methods.map((item) => label(text(item))).filter(Boolean);
}

function rangeOf(billing: Record<string, unknown> | null): string | null {
  const supported = asRecord(billing?.supported_range);
  const minimum = asRecord(supported?.minimum);
  const maximum = asRecord(supported?.maximum);
  const min = numberOf(minimum?.value);
  const max = numberOf(maximum?.value);
  const unit = text(minimum?.unit) || text(maximum?.unit) || text(billing?.quantity_unit);
  if (min == null || max == null) return null;
  return `${min}–${max}${unit ? ` ${unit}` : ""}`;
}

function volumetricOf(billing: Record<string, unknown> | null): string | null {
  const volumetric = asRecord(billing?.volumetric_weight);
  if (!volumetric) return null;
  if (volumetric.enabled !== true) return "Charged on actual weight";
  const divisor = numberOf(volumetric.divisor);
  return divisor == null ? "Volumetric weight applies" : `Volumetric weight applies, divisor ${divisor}`;
}

function restrictionsOf(channel: Record<string, unknown>): string[] {
  const rules = asRecord(channel.channel_rules);
  const items = Array.isArray(rules?.items) ? rules.items : [];
  return items.flatMap((item) => {
    const rule = asRecord(item);
    if (!rule || text(rule.rule_type) !== "FORBID_ORDERING") return [];
    const name = text(rule.name);
    return name ? [name] : [];
  });
}

function servicesOf(channel: Record<string, unknown>, audience: "public" | "admin"): ChannelService[] {
  if (!Array.isArray(channel.value_added_services)) return [];
  return channel.value_added_services.flatMap((item) => {
    const service = asRecord(item);
    if (!service) return [];
    const name = text(service.name) || text(service.code);
    if (!name) return [];
    const mode = text(service.request_mode) === "MANDATORY" ? "Required" : "Optional";
    return [{ name, mode, description: text(service.description) || null, price: audience === "admin" ? servicePrice(service) : null }];
  });
}

function servicePrice(service: Record<string, unknown>): string | null {
  const prices = Array.isArray(service.region_prices) ? service.region_prices : [];
  const price = asRecord(prices[0]);
  if (!price) return null;
  if (text(price.value_unit) === "PERCENT" && numberOf(price.value) != null) return `${numberOf(price.value)}%`;
  const fixed = asRecord(price.fixed_charge);
  const amount = numberOf(fixed?.amount);
  return amount == null ? null : formatCnyFen(amount);
}

function rateCardsOf(channel: Record<string, unknown>, regions: { name: string; code: string }[]): ChannelRateCard[] {
  if (!Array.isArray(channel.rate_cards)) return [];
  return channel.rate_cards.flatMap((item) => {
    const card = asRecord(item);
    if (!card) return [];
    const code = text(card.region_code);
    const region = regions.find((entry) => entry.code === code)?.name || code || "Rate card";
    const rows = Array.isArray(card.price_rows) ? card.price_rows.flatMap((row) => rateRow(row)) : [];
    return rows.length ? [{ region, rows }] : [];
  });
}

function rateRow(value: unknown): ChannelRateRow[] {
  const row = asRecord(value);
  const charge = asRecord(row?.charge);
  const amount = numberOf(charge?.amount);
  if (!row || amount == null) return [];
  const range = asRecord(row.range);
  const span = range ? `${numberOf(range.minimum) ?? ""}–${numberOf(range.maximum) ?? ""} ${text(range.unit)}`.trim() : "All quantities";
  return [{ label: label(text(row.type) || "Charge"), range: span, amount: formatCnyFen(amount) }];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function label(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}
