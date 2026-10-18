import { eq } from "drizzle-orm";
import { z } from "zod";
import { countryName } from "../src/domain/countries";
import { presentChannelDetail, type ChannelDetail } from "../src/domain/channel-detail";
import { priceLiveQuotes, publicQuotes, type ItemAttribute, type LiveQuote, type PricedQuote, type PublicQuote } from "../src/domain/live-quote";
import type { CargoAttribute } from "../src/domain/status";
import type { RouteQuote } from "../src/domain/shipping";
import type { Database } from "./db/client";
import { freightAreas } from "./db/schema";
import { AppError } from "./errors";
import { fulfillmentConnected, resolveHioBuyToken, sellingPolicy } from "./freight";
import { fetchChannelDetail, fetchItemAttributes, fetchShippingQuotes, type QuoteRequest } from "./services/hiobuy/quotes";

export type CalculatorInput = QuoteRequest;

export type CalculatorOptions = {
  connected: boolean;
  countries: { code: string; name: string }[];
  attributes: ItemAttribute[];
  message: string | null;
};

const attributeCache = new Map<string, { at: number; rows: ItemAttribute[] }>();

const calculatorBody = z.object({
  countryCode: z.string().trim().toUpperCase().length(2, "Choose a destination country."),
  weightKg: z.number().positive("Weight must be greater than 0 kg.").max(100000),
  lengthCm: z.number().positive().max(10000).optional(),
  widthCm: z.number().positive().max(10000).optional(),
  heightCm: z.number().positive().max(10000).optional(),
  attribute: z.string().trim().min(1, "Choose a cargo type.").max(64),
});

export function parseCalculatorInput(value: unknown): CalculatorInput {
  const parsed = calculatorBody.safeParse(value);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Check the shipment details.");
  const body = parsed.data;
  const present = [body.lengthCm, body.widthCm, body.heightCm].filter((item) => item != null).length;
  if (present !== 0 && present !== 3) throw new AppError("VALIDATION_ERROR", "Enter all three dimensions, or leave all three blank.");
  return { countryCode: body.countryCode, weightKg: body.weightKg, lengthCm: body.lengthCm, widthCm: body.widthCm, heightCm: body.heightCm, attributes: [body.attribute] };
}

export async function calculatorOptions(db: Database, envToken: string | undefined): Promise<CalculatorOptions> {
  if (!(await fulfillmentConnected(db))) {
    return { connected: false, countries: [], attributes: [], message: "Shipping estimates aren't available until HioBuy is connected." };
  }
  const areas = await db.select().from(freightAreas).where(eq(freightAreas.enabled, true));
  const countries = [...new Set(areas.map((row) => row.countryCode))].sort().map((code) => ({ code, name: countryName(code) }));
  const token = await resolveHioBuyToken(db, envToken);
  if (!token) return { connected: false, countries, attributes: [], message: "Add a HioBuy API key before requesting quotes." };
  try {
    return { connected: true, countries, attributes: await cachedAttributes(token), message: countries.length ? null : "No destination countries are open yet." };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Cargo types could not be loaded.";
    return { connected: true, countries, attributes: [], message };
  }
}

function transitDays(transit: LiveQuote["transit_time"]): { min: number; max: number } | null {
  const min = transit?.min_business_days ?? transit?.min_days;
  const max = transit?.max_business_days ?? transit?.max_days ?? min;
  if (min == null || max == null) return null;
  return { min, max };
}

function attributeCodes(catalog: ItemAttribute[], cargo: CargoAttribute[]): string[] {
  const wanted = new Set(cargo.map((item) => item.toLowerCase()));
  return catalog.filter((item) => wanted.has(item.code.toLowerCase()) || wanted.has(item.name.toLowerCase())).map((item) => item.code);
}

/** Same HioBuy quote the shipping calculator uses, shaped for consolidation. */
export async function liveShipmentRoutes(
  db: Database,
  envToken: string | undefined,
  input: { countryCode: string; weightGrams: number; lengthMm: number | null; widthMm: number | null; heightMm: number | null; cargo: CargoAttribute[] },
): Promise<{ closed: boolean; routes: RouteQuote[]; upstreamMessage: string | null }> {
  const areas = await db.select().from(freightAreas).where(eq(freightAreas.countryCode, input.countryCode));
  if (!areas.some((row) => row.enabled)) return { closed: true, routes: [], upstreamMessage: null };
  const token = await resolveHioBuyToken(db, envToken);
  if (!token) return { closed: false, routes: [], upstreamMessage: "Add a HioBuy API key before requesting quotes." };
  const catalog = await cachedAttributes(token).catch(() => [] as ItemAttribute[]);
  const attributes = attributeCodes(catalog, input.cargo.length ? input.cargo : ["GENERAL"]);
  const hasSize = input.lengthMm != null && input.widthMm != null && input.heightMm != null && input.lengthMm > 0 && input.widthMm > 0 && input.heightMm > 0;
  let live: LiveQuote[];
  try {
    live = await fetchShippingQuotes(token, {
      countryCode: input.countryCode,
      weightKg: input.weightGrams / 1000,
      lengthCm: hasSize ? input.lengthMm! / 10 : undefined,
      widthCm: hasSize ? input.widthMm! / 10 : undefined,
      heightCm: hasSize ? input.heightMm! / 10 : undefined,
      attributes,
    });
  } catch (error) {
    return { closed: false, routes: [], upstreamMessage: error instanceof AppError ? error.message : "HioBuy shipping quotes did not respond." };
  }
  const policy = await sellingPolicy(db);
  const priced = priceLiveQuotes(live, policy);
  const byCode = new Map(live.map((quote) => [quote.channel?.code?.trim() ?? "", quote]));
  const routes: RouteQuote[] = priced.map((quote) => {
    const source = byCode.get(quote.code);
    const days = transitDays(source?.transit_time);
    return {
      routeCode: quote.code,
      routeName: quote.name,
      description: quote.description ?? quote.eta ?? "",
      currency: "USD",
      estimatedMinFen: quote.priceUsdFen,
      estimatedMaxFen: quote.priceUsdFen,
      daysMin: days?.min ?? 0,
      daysMax: days?.max ?? 0,
      supportsTracking: true,
      doorToDoor: true,
      taxNote: quote.note ?? "Recipient responsible if applicable",
      cargoCapabilities: input.cargo.length ? input.cargo : ["GENERAL"],
      restrictions: quote.partial ? "Estimate may change after packing" : "Door to door",
    };
  });
  return { closed: false, routes, upstreamMessage: null };
}

export async function estimateShipping(db: Database, envToken: string | undefined, input: CalculatorInput, audience: "public" | "admin"): Promise<{ quotes: PublicQuote[] | PricedQuote[]; disclaimer: string }> {
  if (!(await fulfillmentConnected(db))) throw new AppError("UPSTREAM_ERROR", "HioBuy isn't connected, so shipping estimates aren't available.", 409);
  const areas = await db.select().from(freightAreas).where(eq(freightAreas.countryCode, input.countryCode));
  if (!areas.some((row) => row.enabled)) throw new AppError("DESTINATION_CLOSED", "Shipping to this country is not open.");
  const token = await resolveHioBuyToken(db, envToken);
  if (!token) throw new AppError("UPSTREAM_ERROR", "HioBuy isn't connected, so shipping estimates aren't available.", 409);
  const live = await fetchShippingQuotes(token, input);
  const policy = await sellingPolicy(db);
  const priced = priceLiveQuotes(live, policy);
  const disclaimer = "Estimated from declared weight and size. The final charge is set after the warehouse packs the shipment.";
  return { quotes: audience === "admin" ? priced : publicQuotes(priced), disclaimer };
}

export async function channelDetail(db: Database, envToken: string | undefined, code: string, countryCode: string, audience: "public" | "admin"): Promise<ChannelDetail> {
  const channelCode = code.trim();
  if (!channelCode || channelCode.length > 80) throw new AppError("VALIDATION_ERROR", "Choose a shipping channel.");
  if (!/^[A-Za-z]{2}$/.test(countryCode)) throw new AppError("VALIDATION_ERROR", "Choose a destination country.");
  if (!(await fulfillmentConnected(db))) throw new AppError("UPSTREAM_ERROR", "HioBuy isn't connected, so channel details aren't available.", 409);
  const areas = await db.select().from(freightAreas).where(eq(freightAreas.countryCode, countryCode.toUpperCase()));
  if (!areas.some((row) => row.enabled)) throw new AppError("DESTINATION_CLOSED", "Shipping to this country is not open.");
  const token = await resolveHioBuyToken(db, envToken);
  if (!token) throw new AppError("UPSTREAM_ERROR", "HioBuy isn't connected, so channel details aren't available.", 409);
  const payload = await fetchChannelDetail(token, channelCode, countryCode.toUpperCase());
  const detail = presentChannelDetail(payload, countryCode.toUpperCase(), audience);
  if (!detail) throw new AppError("NOT_FOUND", "Channel details were not found for this destination.", 404);
  return detail;
}

async function cachedAttributes(token: string): Promise<ItemAttribute[]> {
  const hit = attributeCache.get(token);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.rows;
  const rows = await fetchItemAttributes(token);
  attributeCache.set(token, { at: Date.now(), rows });
  return rows;
}
