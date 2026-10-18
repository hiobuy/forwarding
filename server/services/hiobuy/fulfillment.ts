import { AppError } from "../../errors";

export type UpstreamCall = {
  timedOut: boolean;
  status: number;
  payload: unknown;
};

async function callHiobuy(token: string, path: string, init: RequestInit): Promise<UpstreamCall> {
  if (!token.trim()) {
    return { timedOut: false, status: 401, payload: { error: { code: "INVALID_API_KEY", message: "API key is missing." } } };
  }
  try {
    const response = await fetch(`https://api.hiobuy.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
    });
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = { error: { code: "INVALID_RESPONSE", message: "HioBuy returned a response that was not JSON." } };
    }
    return { timedOut: false, status: response.status, payload };
  } catch {
    return { timedOut: true, status: 0, payload: null };
  }
}

export function createInboundNotice(token: string, body: unknown, idempotencyKey: string) {
  return callHiobuy(token, "/v1/fulfillment/inbounds/create", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function createFulfillmentShipment(token: string, body: unknown, idempotencyKey: string) {
  return callHiobuy(token, "/v1/fulfillment/shipments/create", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function payFulfillmentShipment(token: string, shipmentId: string, idempotencyKey: string) {
  return callHiobuy(token, `/v1/fulfillment/shipments/${encodeURIComponent(shipmentId)}/pay`, {
    method: "POST",
    body: "{}",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function cancelFulfillmentShipment(token: string, shipmentId: string, cancelReason: string) {
  return callHiobuy(token, `/v1/fulfillment/shipments/${encodeURIComponent(shipmentId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ cancel_reason: cancelReason }),
  });
}

export function interceptFulfillmentShipment(token: string, shipmentId: string, reason: string, remark: string) {
  return callHiobuy(token, `/v1/fulfillment/shipments/${encodeURIComponent(shipmentId)}/intercept`, {
    method: "POST",
    body: JSON.stringify({ reason, remark }),
  });
}

export function listFulfillmentShipments(token: string, page: number, pageSize: number) {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return callHiobuy(token, `/v1/fulfillment/shipments?${query}`, { method: "GET" });
}

export function cancelInboundNotice(token: string, id: string) {
  return callHiobuy(token, `/v1/fulfillment/inbounds/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function readFulfillmentPackage(token: string, packageId: string) {
  return callHiobuy(token, `/v1/fulfillment/packages/${encodeURIComponent(packageId)}`, { method: "GET" });
}

export function listFulfillmentPackages(token: string, page: number, pageSize: number) {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return callHiobuy(token, `/v1/fulfillment/packages?${query}`, { method: "GET" });
}

export function readFulfillmentShipment(token: string, shipmentId: string) {
  return callHiobuy(token, `/v1/fulfillment/shipments/${encodeURIComponent(shipmentId)}`, { method: "GET" });
}

export function readFulfillmentShipmentTracking(token: string, shipmentId: string) {
  return callHiobuy(token, `/v1/fulfillment/shipments/${encodeURIComponent(shipmentId)}/tracking`, { method: "GET" });
}

export function upstreamRequestId(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as { request_id?: unknown; error?: { request_id?: unknown } };
  const value = root.error?.request_id ?? root.request_id;
  return typeof value === "string" ? value : null;
}

export function assertUpstreamConfigured(token: string | undefined): string {
  if (!token?.trim()) throw new AppError("VALIDATION_ERROR", "Connect a HioBuy API key first.");
  return token.trim();
}
