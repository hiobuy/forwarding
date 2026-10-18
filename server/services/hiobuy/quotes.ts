import { AppError } from "../../errors";
import { readItemAttributes, readQuoteList, type ItemAttribute, type LiveQuote } from "../../../src/domain/live-quote";

const QUOTES = "https://api.hiobuy.com/v1/fulfillment/shipping/quotes";
const ATTRIBUTES = "https://api.hiobuy.com/v1/fulfillment/shipments/item-attributes";

export type QuoteRequest = {
  countryCode: string;
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  attributes: string[];
};

/** Declared-weight quote. The browser never calls this. */
export async function fetchShippingQuotes(token: string, input: QuoteRequest): Promise<LiveQuote[]> {
  const body: Record<string, unknown> = {
    destination: { country_code: input.countryCode },
    weight_kg: input.weightKg,
  };
  if (input.lengthCm && input.widthCm && input.heightCm) {
    body.length_cm = input.lengthCm;
    body.width_cm = input.widthCm;
    body.height_cm = input.heightCm;
  }
  if (input.attributes.length) body.attributes = input.attributes;
  const payload = await postJson(token, QUOTES, body);
  return readQuoteList(payload);
}

export async function fetchItemAttributes(token: string): Promise<ItemAttribute[]> {
  const url = new URL(ATTRIBUTES);
  url.searchParams.set("language", "en");
  let response: Response;
  try {
    response = await fetch(url, { headers: headers(token) });
  } catch {
    throw new AppError("UPSTREAM_TIMEOUT", "HioBuy cargo types did not respond. Try again.", 504);
  }
  const payload = await readPayload(response);
  return readItemAttributes(payload);
}

export async function fetchChannelDetail(token: string, code: string, countryCode: string): Promise<unknown> {
  const url = new URL(`https://api.hiobuy.com/v1/fulfillment/shipping/channels/${encodeURIComponent(code)}`);
  url.searchParams.set("country_code", countryCode);
  url.searchParams.set("include", "regions,services,rate_cards,rules");
  let response: Response;
  try {
    response = await fetch(url, { headers: headers(token) });
  } catch {
    throw new AppError("UPSTREAM_TIMEOUT", "HioBuy channel details did not respond. Try again.", 504);
  }
  return readPayload(response);
}

async function postJson(token: string, url: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { ...headers(token), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new AppError("UPSTREAM_TIMEOUT", "HioBuy shipping quotes did not respond. Try again.", 504);
  }
  return readPayload(response);
}

function headers(token: string): HeadersInit {
  return { Authorization: `Bearer ${token.trim()}`, Accept: "application/json", Language: "en" };
}

async function readPayload(response: Response): Promise<unknown> {
  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new AppError("UPSTREAM_ERROR", "HioBuy returned a quote response that was not JSON.", 502);
  }
  const failure = businessFailure(payload);
  if (!response.ok || failure) {
    const status = response.status;
    const code = failure?.code;
    if (status === 429 || code === "RATE_LIMITED") throw new AppError("RATE_LIMITED", "HioBuy is limiting quote requests. Wait a moment and try again.", 429);
    if (code === "INVALID_ITEM_ATTRIBUTE") throw new AppError("VALIDATION_ERROR", "That cargo type is not accepted for a shipping quote.");
    if (code === "INVALID_COUNTRY_CODE") throw new AppError("VALIDATION_ERROR", "That destination country is not valid.");
    if (status === 401 || code === "INVALID_API_KEY") throw new AppError("UPSTREAM_ERROR", "HioBuy rejected the API key, so quotes are unavailable.", 502);
    if (status === 403 || code === "FULFILLMENT_MODE_NOT_SUPPORTED" || code === "WAREHOUSE_AUTH_INVALID") {
      throw new AppError("UPSTREAM_ERROR", "This API key cannot request warehouse shipping quotes.", 502);
    }
    throw new AppError("UPSTREAM_ERROR", failure?.message || "HioBuy could not calculate shipping rates.", status >= 500 ? 502 : 502);
  }
  return payload;
}

function businessFailure(payload: unknown): { code?: string; message: string } | null {
  if (!payload || typeof payload !== "object" || !("success" in payload) || (payload as { success?: unknown }).success !== false) return null;
  const record = payload as { code?: unknown; msg?: unknown; error?: { code?: unknown; message?: unknown } };
  const code = typeof record.code === "string" ? record.code : typeof record.error?.code === "string" ? record.error.code : undefined;
  const message = typeof record.msg === "string" ? record.msg : typeof record.error?.message === "string" ? record.error.message : "HioBuy could not calculate shipping rates.";
  return { code, message };
}
