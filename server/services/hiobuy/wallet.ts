import { AppError } from "../../errors";

const BALANCE = "https://api.hiobuy.com/v1/fulfillment/balance";
const TRANSACTIONS = "https://api.hiobuy.com/v1/fulfillment/transactions";

export type TransactionQuery = {
  type?: string;
  category?: string;
  createdFrom?: string;
  createdTo?: string;
  page: number;
  pageSize: number;
};

export async function fetchFulfillmentBalance(token: string): Promise<unknown> {
  return getJson(token, BALANCE);
}

export async function fetchFulfillmentTransactions(token: string, query: TransactionQuery): Promise<unknown> {
  const url = new URL(TRANSACTIONS);
  if (query.type) url.searchParams.set("type", query.type);
  if (query.category) url.searchParams.set("category", query.category);
  if (query.createdFrom) url.searchParams.set("created_from", query.createdFrom);
  if (query.createdTo) url.searchParams.set("created_to", query.createdTo);
  url.searchParams.set("page", String(query.page));
  url.searchParams.set("page_size", String(query.pageSize));
  return getJson(token, url.toString());
}

export async function fetchFulfillmentTransaction(token: string, id: string): Promise<unknown> {
  return getJson(token, `${TRANSACTIONS}/${encodeURIComponent(id)}`);
}

async function getJson(token: string, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json", Language: "en" } });
  } catch {
    throw new AppError("UPSTREAM_TIMEOUT", "HioBuy wallet did not respond. Try again.", 504);
  }
  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new AppError("UPSTREAM_ERROR", "HioBuy returned a wallet response that was not JSON.", 502);
  }
  if (!response.ok || businessFailure(payload)) {
    const failure = businessFailure(payload);
    const code = failure?.code;
    if (response.status === 429 || code === "RATE_LIMITED") throw new AppError("RATE_LIMITED", "HioBuy is limiting wallet requests. Wait a moment and try again.", 429);
    if (response.status === 401 || code === "INVALID_API_KEY") throw new AppError("UPSTREAM_ERROR", "HioBuy rejected the API key for the fulfillment wallet.", 502);
    if (response.status === 403 || code === "FULFILLMENT_MODE_NOT_SUPPORTED" || code === "WAREHOUSE_AUTH_INVALID") {
      throw new AppError("UPSTREAM_ERROR", "This API key cannot read the HioBuy fulfillment wallet. It needs warehouse access.", 502);
    }
    throw new AppError("UPSTREAM_ERROR", failure?.message || "HioBuy wallet could not be loaded.", 502);
  }
  return payload;
}

function businessFailure(payload: unknown): { code?: string; message: string } | null {
  if (!payload || typeof payload !== "object" || !("success" in payload) || (payload as { success?: unknown }).success !== false) return null;
  const record = payload as { code?: unknown; msg?: unknown; error?: { code?: unknown; message?: unknown } };
  return {
    code: typeof record.code === "string" ? record.code : typeof record.error?.code === "string" ? record.error.code : undefined,
    message: typeof record.msg === "string" ? record.msg : typeof record.error?.message === "string" ? record.error.message : "HioBuy wallet could not be loaded.",
  };
}
