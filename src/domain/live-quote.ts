import { customerUsdFen, markedUpCnyFen, type SellingPolicy } from "./freight";
import { cnyFenToUsdFen } from "./earnings";

/** A quote row from HioBuy. Amounts are CNY fen (`CNY_minor`). */
export type LiveQuote = {
  channel: { code?: string; name?: string; description?: string | null };
  available?: boolean;
  quote_status?: string;
  unavailable_reason?: { message?: string } | null;
  transit_time?: {
    text?: string;
    min_business_days?: number;
    max_business_days?: number;
    min_days?: number;
    max_days?: number;
  } | null;
  total?: { amount?: number | null } | null;
  known_total?: { amount?: number | null } | null;
  warnings?: { message?: string }[];
};

export type PricedQuote = {
  code: string;
  name: string;
  description: string | null;
  eta: string | null;
  partial: boolean;
  note: string | null;
  priceUsdFen: number;
  costCnyFen: number;
  markupCnyFen: number;
  profitUsdFen: number;
  cnyPerUsdE4: number;
};

export type PublicQuote = {
  code: string;
  name: string;
  description: string | null;
  eta: string | null;
  partial: boolean;
  note: string | null;
  priceUsdFen: number;
};

/** Same transit wording as the shipping-quotes demo: structured days first, then text. */
export function formatTransitTime(transit: LiveQuote["transit_time"]): string | null {
  if (!transit) return null;
  const minimum = transit.min_business_days ?? transit.min_days;
  const maximum = transit.max_business_days ?? transit.max_days;
  if (minimum == null || maximum == null) return transit.text?.trim() || null;
  if (minimum === maximum) return `${minimum} business ${minimum === 1 ? "day" : "days"}`;
  return `${minimum}–${maximum} business days`;
}

function costFen(quote: LiveQuote): { fen: number; partial: boolean } | null {
  const total = quote.total?.amount;
  if (typeof total === "number" && Number.isFinite(total)) return { fen: Math.round(total), partial: false };
  const known = quote.known_total?.amount;
  if (typeof known === "number" && Number.isFinite(known)) return { fen: Math.round(known), partial: true };
  return null;
}

/** Apply the current selling policy once. Unavailable rows and rows without a cost are omitted. */
export function priceLiveQuotes(quotes: LiveQuote[], policy: SellingPolicy): PricedQuote[] {
  const priced: PricedQuote[] = [];
  for (const quote of quotes) {
    if (quote.available === false || quote.quote_status === "UNAVAILABLE") continue;
    const code = quote.channel?.code?.trim();
    if (!code) continue;
    const cost = costFen(quote);
    if (!cost || cost.fen < 0) continue;
    const priceUsdFen = customerUsdFen(cost.fen, policy);
    const costUsdFen = cnyFenToUsdFen(cost.fen, policy.cnyPerUsdE4);
    if (costUsdFen == null) continue;
    const warning = quote.warnings?.find((item) => item.message?.trim())?.message?.trim() ?? null;
    priced.push({
      code,
      name: quote.channel.name?.trim() || code,
      description: quote.channel.description?.trim() || null,
      eta: formatTransitTime(quote.transit_time),
      partial: cost.partial || quote.quote_status === "PARTIAL",
      note: warning,
      priceUsdFen,
      costCnyFen: cost.fen,
      markupCnyFen: markedUpCnyFen(cost.fen, policy) - cost.fen,
      profitUsdFen: priceUsdFen - costUsdFen,
      cnyPerUsdE4: policy.cnyPerUsdE4,
    });
  }
  return priced.sort((left, right) => left.priceUsdFen - right.priceUsdFen || left.code.localeCompare(right.code));
}

/** Customers and visitors never receive cost, markup, rate, or profit. */
export function publicQuotes(quotes: PricedQuote[]): PublicQuote[] {
  return quotes.map(({ code, name, description, eta, partial, note, priceUsdFen }) => ({ code, name, description, eta, partial, note, priceUsdFen }));
}

export function readQuoteList(payload: unknown): LiveQuote[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as { quotes?: unknown; data?: { quotes?: unknown } };
  const quotes = Array.isArray(root.quotes) ? root.quotes : Array.isArray(root.data?.quotes) ? root.data.quotes : [];
  return quotes.filter((item): item is LiveQuote => Boolean(item) && typeof item === "object");
}

export type ItemAttribute = { code: string; name: string };

export function readItemAttributes(payload: unknown): ItemAttribute[] {
  const list = attributeList(payload);
  const rows: ItemAttribute[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as { code?: unknown; name?: unknown };
    const code = typeof record.code === "string" ? record.code.trim() : "";
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : code;
    rows.push({ code, name });
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

function attributeList(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as { items?: unknown; data?: unknown; attributes?: unknown };
  if (Array.isArray(root.items)) return root.items;
  if (Array.isArray(root.attributes)) return root.attributes;
  if (Array.isArray(root.data)) return root.data;
  if (root.data && typeof root.data === "object") {
    const data = root.data as { items?: unknown; attributes?: unknown };
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.attributes)) return data.attributes;
  }
  return [];
}
