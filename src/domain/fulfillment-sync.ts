/**
 * Fulfillment sync rules. Package and shipment business status stay separate from these states.
 * HioBuy inbound create returns a notice, not a warehouse receipt.
 * One local shipment can map to several warehouse packages and outbound cartons.
 */

import { PACKAGE_LIFECYCLE } from "./status";

export const SYNC_ATTEMPT_LIMIT = 8;

export type SyncTaskStatus = "waiting" | "pending" | "syncing" | "synced" | "failed" | "needs_review" | "skipped" | "candidate";

export type SyncBucket = "pending" | "syncing" | "synced" | "failed" | "needs_review";

export type ErrorClass = "transient" | "rate_limit" | "auth" | "conflict" | "validation" | "funds" | "unknown";

export type HistoryClass = "already_linked" | "candidate" | "skipped" | "needs_review";

export type SyncOutcome =
  | { kind: "synced"; remoteId: string; remoteStatus: string; orderSn: string | null; noticeId?: string | null; warehousePackageId?: string | null }
  | { kind: "retry"; errorClass: "transient" | "rate_limit"; code: string; message: string; retryAfterMs: number | null }
  | { kind: "pause"; code: string; message: string }
  | { kind: "review"; code: string; message: string }
  | { kind: "failed"; errorClass: ErrorClass; code: string; message: string };

type ExistingResource = {
  packageId?: string;
  shipmentId?: string;
  tracking?: string;
  external?: string | null;
  status?: string;
  orderSn?: string | null;
};

const STATUS_ALIASES: Record<string, string> = {
  pending_receive: "PENDING",
  pending: "PENDING",
  received: "RECEIVED",
  consolidated: "CONSOLIDATED",
  shipped: "SHIPPED",
  dispatched: "SHIPPED",
  delivered: "DELIVERED",
  signed: "SIGNED",
  wait_payment: "WAIT_PAYMENT",
  ready_for_payment: "WAIT_PAYMENT",
  wait_ship: "WAIT_SHIP",
  cancelled: "CANCELLED",
  canceled: "CANCELLED",
  discarded: "DISCARDED",
  unclaimed: "UNCLAIMED",
  archived: "ARCHIVED",
  transferring: "TRANSFERRING",
  exception: "RECEIVED",
};

const RANK: Record<string, number> = {
  PENDING: 1,
  RECEIVED: 2,
  WAIT_PAYMENT: 3,
  CONSOLIDATED: 3,
  WAIT_SHIP: 4,
  SHIPPED: 5,
  DELIVERED: 6,
  SIGNED: 6,
};

export function externalPackageRef(localId: string) {
  return `pkg_${localId}`;
}

export function externalShipmentRef(localId: string) {
  return `shp_${localId}`;
}

export function inboundIdempotencyKey(localId: string) {
  return `inbound:${localId}`;
}

export function shipmentIdempotencyKey(localId: string) {
  return `shipment:${localId}`;
}

export function payIdempotencyKey(localId: string) {
  return `shipment-pay:${localId}`;
}

export function canonicalRemoteStatus(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const key = raw.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  return STATUS_ALIASES[key] ?? raw.trim().toUpperCase();
}

export function remoteRank(status: string | null | undefined): number | null {
  const canonical = canonicalRemoteStatus(status);
  if (!canonical) return null;
  return RANK[canonical] ?? null;
}

export function syncBucket(status: string | null | undefined): SyncBucket | null {
  if (status === "pending" || status === "waiting") return "pending";
  if (status === "syncing") return "syncing";
  if (status === "synced") return "synced";
  if (status === "failed") return "failed";
  if (status === "needs_review" || status === "candidate" || status === "skipped") return "needs_review";
  return null;
}

export function syncListLabel(status: string | null | undefined): string {
  const bucket = syncBucket(status);
  if (bucket === "pending") return "Pending";
  if (bucket === "syncing") return "Syncing";
  if (bucket === "synced") return "Synced";
  if (bucket === "failed") return "Failed";
  if (bucket === "needs_review") return "Needs review";
  return "Not linked";
}

/** Package list badge. This is sync state, not the warehouse lifecycle. */
export function packageSyncLabel(input: { connected: boolean; taskStatus: string | null; remoteId: string | null }) {
  if (input.taskStatus === "syncing") return "Syncing";
  if (input.taskStatus === "pending" || input.taskStatus === "waiting") return "Pending";
  if (input.taskStatus === "failed") return "Failed";
  if (input.taskStatus === "needs_review") return "Needs review";
  if (input.remoteId || input.taskStatus === "synced") return "Synced";
  if (!input.connected) return "Not Connected";
  return "Not synced";
}

/** Plain reason for a package row. A tracking conflict is not a second create. */
export function explainPackageSyncIssue(code: string | null | undefined, message: string | null | undefined) {
  if (code === "INBOUND_TRACKING_ALREADY_EXISTS") return "This tracking number is already at HioBuy, so this package was not created again.";
  if (code === "EXTERNAL_ORDER_ID_ALREADY_EXISTS") return "HioBuy already has this package reference. It was not created again.";
  if (code === "TIMEOUT") return "HioBuy did not answer. The same request will be retried. Nothing was created again.";
  const text = message?.trim();
  return text || null;
}

/** A synced, in-flight, or conflicted package cannot be submitted again. A failed attempt can. */
export function packageCanSync(input: { packageStatus: string; disposition?: string | null; taskStatus: string | null; remoteId: string | null }) {
  if (input.remoteId || input.taskStatus === "synced" || input.taskStatus === "syncing" || input.taskStatus === "pending" || input.taskStatus === "waiting") return false;
  if (input.taskStatus === "needs_review") return false;
  if (input.disposition === "RETURN_REQUESTED" || input.disposition === "DISPOSAL_REQUESTED") return false;
  if (input.packageStatus === "CONSOLIDATED" || input.packageStatus === "SHIPPED" || input.packageStatus === "DELIVERED" || input.packageStatus === "DISCARDED" || input.packageStatus === "ARCHIVED") return false;
  return true;
}

/** Auto-sync creates a task only when the switch is on and warehouse authorization is usable. */
export function shouldAutoEnqueueInbound(input: { auto: boolean; connected: boolean; paused: boolean }) {
  if (!input.auto || !input.connected || input.paused) return "local_only" as const;
  return "pending" as const;
}

/** Creating an inbound notice does not mean the warehouse has the parcel. */
export function localPackageStatusAfterInboundCreate(packageStatus: string) {
  return packageStatus;
}

export function enqueueInbound(connected: boolean): "pending" | "local_only" {
  return connected ? "pending" : "local_only";
}

export function enqueueShipment(connected: boolean, ready: boolean): "local_only" | "pending" | "waiting" {
  if (!connected) return "local_only";
  return ready ? "pending" : "waiting";
}

export function allowRemoteCreate(remoteId: string | null, taskStatus: string | null) {
  if (remoteId) return false;
  if (taskStatus === "synced" || taskStatus === "syncing") return false;
  return true;
}

export function nextRetryAt(attempt: number, now: number, retryAfterMs?: number | null) {
  if (attempt >= SYNC_ATTEMPT_LIMIT) return null;
  const backoff = Math.min(30_000 * 4 ** Math.max(0, attempt - 1), 2 * 60 * 60 * 1000);
  return now + Math.max(backoff, retryAfterMs ?? 0);
}

export function canManualRetry(status: string, errorClass: string | null) {
  if (status !== "failed") return false;
  return errorClass === "transient" || errorClass === "rate_limit" || errorClass === "auth" || errorClass === "unknown" || errorClass === "funds";
}

export function redactSensitive(value: string) {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk|rk|whsec)_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/(api[_-]?key|token|secret)(["']?\s*[:=]\s*["']?)[^"'\s,}]*/gi, "$1$2[redacted]")
    .slice(0, 500);
}

export function walletAfterHiobuyPayFailure(balanceFen: number) {
  return balanceFen;
}

export function classifyPackageHistory(input: { remoteId: string | null; packageStatus: string; disposition: string }): HistoryClass {
  if (input.remoteId) return "already_linked";
  if (input.packageStatus === "SHIPPED" || input.packageStatus === "DELIVERED" || input.packageStatus === "CONSOLIDATED" || input.packageStatus === "DISCARDED" || input.packageStatus === "ARCHIVED" || input.disposition === "DISPOSAL_REQUESTED" || input.disposition === "RETURN_REQUESTED") return "skipped";
  if (input.packageStatus === "PENDING") return "candidate";
  return "needs_review";
}

export function classifyShipmentHistory(input: { remoteId: string | null; status: string; packagesReady: boolean }): HistoryClass {
  if (input.remoteId) return "already_linked";
  if (input.status === "CANCELLED" || input.status === "DELIVERED" || input.status === "SHIPPED" || input.status === "IN_TRANSIT") return "skipped";
  if ((input.status === "CONSOLIDATING" || input.status === "WAITING_FOR_WEIGHT") && input.packagesReady) return "candidate";
  if (input.status === "CONSOLIDATING" || input.status === "WAITING_FOR_WEIGHT") return "needs_review";
  return "needs_review";
}

type AddressInput = {
  name: string;
  phone: string;
  countryCode: string;
  state: string;
  city: string;
  district?: string | null;
  postalCode: string;
  addressLine1: string;
  addressLine2?: string | null;
};

export function shipmentCreateReady(input: {
  connected: boolean;
  paused: boolean;
  localStatus: string;
  remoteShipmentId: string | null;
  channelCode: string | null;
  address: AddressInput | null;
  packages: { remoteId: string | null; remoteStatus: string | null }[];
}) {
  if (!input.connected) return { ready: false, reason: "HioBuy is not connected." };
  if (input.paused) return { ready: false, reason: "HioBuy authorization is paused." };
  if (input.remoteShipmentId) return { ready: false, reason: "A HioBuy shipment is already linked." };
  if (input.localStatus !== "CONSOLIDATING" && input.localStatus !== "WAITING_FOR_WEIGHT") {
    return { ready: false, reason: "This shipment is not waiting for warehouse packing." };
  }
  if (!input.packages.length) return { ready: false, reason: "The shipment has no packages." };
  if (input.packages.some((pkg) => !pkg.remoteId)) return { ready: false, reason: "A package is not linked to HioBuy yet." };
  if (input.packages.some((pkg) => canonicalRemoteStatus(pkg.remoteStatus) !== "RECEIVED")) {
    return { ready: false, reason: "A package is not received at the HioBuy warehouse." };
  }
  if (!input.channelCode?.trim()) return { ready: false, reason: "The shipping channel is missing." };
  const address = input.address;
  if (!address?.name?.trim() || !address.phone?.trim() || !address.countryCode?.trim() || !address.city?.trim() || !address.postalCode?.trim() || !address.addressLine1?.trim()) {
    return { ready: false, reason: "The destination address is incomplete." };
  }
  return { ready: true, reason: "" };
}

export function hiobuyReceiver(address: AddressInput) {
  const district = address.district?.trim() ?? "";
  let line1 = address.addressLine1.trim();
  if (district && !line1.includes(district)) {
    line1 = address.countryCode.trim().toUpperCase() === "CN" ? `${district}${line1}` : `${line1}, ${district}`;
  }
  const body: Record<string, string> = {
    name: address.name.trim(),
    mobile: address.phone.trim(),
    country_code: address.countryCode.trim().toUpperCase(),
    postal_code: address.postalCode.trim(),
    province: address.state.trim(),
    city: address.city.trim(),
    address_line1: line1,
  };
  if (address.addressLine2?.trim()) body.address_line2 = address.addressLine2.trim();
  return body;
}

export function inboundNoticeBody(input: {
  tracking: string;
  courier: string;
  externalRef: string;
  declaredValueFen: number | null;
  productName: string | null;
  quantity: number | null;
}) {
  const fen = input.declaredValueFen && input.declaredValueFen > 0 ? input.declaredValueFen : 100;
  const quantity = Math.max(1, input.quantity ?? 1);
  const total = fen / 100;
  return {
    tracking_number: input.tracking,
    carrier: input.courier,
    package_count: 1,
    total_value: Number(total.toFixed(2)),
    currency: "USD",
    external_order_id: input.externalRef,
    items: [
      {
        name: input.productName?.trim() || "Parcel",
        quantity: String(quantity),
        unit_price: (total / quantity).toFixed(2),
        currency: "USD",
      },
    ],
  };
}

export function hiobuyPayReady(input: { customerPaid: boolean; remoteId: string | null; remoteStatus: string | null; paymentStatus: string | null }) {
  const remote = canonicalRemoteStatus(input.remoteStatus);
  const paid = input.paymentStatus === "PAID" || remote === "WAIT_SHIP" || remote === "SHIPPED" || remote === "SIGNED" || remote === "DELIVERED";
  if (!input.customerPaid) return { ready: false, already: false, reason: "The customer has not paid." };
  if (!input.remoteId) return { ready: false, already: false, reason: "No HioBuy shipment is linked." };
  if (input.paymentStatus === "PARTIAL") return { ready: false, already: false, reason: "HioBuy recorded a partial payment. Review it before paying again." };
  if (paid) return { ready: false, already: true, reason: "HioBuy already recorded payment." };
  if (remote !== "WAIT_PAYMENT") return { ready: false, already: false, reason: "HioBuy is not ready for payment." };
  return { ready: true, already: false, reason: "" };
}

export type BillDecision = { kind: "bill"; usdFen: number } | { kind: "mirror" } | { kind: "review"; message: string } | { kind: "ignore" };

export function readyForPaymentDecision(input: { localStatus: string; currentDueFen: number | null; nextUsdFen: number }): BillDecision {
  if (input.localStatus === "CANCELLED" || input.localStatus === "DELIVERED") return { kind: "ignore" };
  if (input.localStatus === "CONSOLIDATING" || input.localStatus === "WAITING_FOR_WEIGHT") {
    if (input.nextUsdFen < 1) return { kind: "review", message: "HioBuy did not return a payable amount." };
    return { kind: "bill", usdFen: input.nextUsdFen };
  }
  if (input.currentDueFen != null && input.currentDueFen !== input.nextUsdFen) {
    return { kind: "review", message: "HioBuy payable amount differs from the local bill." };
  }
  return { kind: "mirror" };
}

export function dispatchDecision(localStatus: string): "ship" | "review" | "ignore" {
  if (localStatus === "READY_TO_SHIP" || localStatus === "SHIPPED") return "ship";
  if (localStatus === "IN_TRANSIT" || localStatus === "DELIVERED" || localStatus === "CANCELLED") return "ignore";
  return "review";
}

export function afterCredentialChange(input: { accessOk: boolean; warehouseIdChanged: boolean }) {
  return {
    clearPause: input.accessOk,
    requeueAuthFailures: input.accessOk,
    reviewOpenTasks: input.warehouseIdChanged,
  };
}

export function webhookDisposition(input: { signatureOk: boolean; duplicate: boolean; incomingRank: number | null; storedRank: number | null }) {
  if (!input.signatureOk) return "reject" as const;
  if (input.duplicate) return "duplicate" as const;
  if (input.incomingRank != null && input.storedRank != null && input.incomingRank < input.storedRank) return "stale" as const;
  return "apply" as const;
}

export async function verifyHioBuySignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300) {
  const match = /^t=(\d+),v1=([0-9a-f]+)$/i.exec(header ?? "");
  if (!match || !secret) return false;
  const stamped = Number(match[1]);
  if (!Number.isFinite(stamped) || Math.abs(nowSec - stamped) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${stamped}.${rawBody}`)));
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const expected = match[2].toLowerCase();
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < hex.length; index += 1) diff |= hex.charCodeAt(index) ^ expected.charCodeAt(index);
  return diff === 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function existingResource(payload: unknown): ExistingResource | null {
  const root = asRecord(payload);
  const error = asRecord(root?.error);
  const details = asRecord(error?.details);
  const one = asRecord(details?.existing_resource);
  const many = Array.isArray(details?.existing_resources) ? asRecord(details.existing_resources[0]) : null;
  const row = one ?? many;
  if (!row) return null;
  return {
    packageId: text(row.package_id) || text(row.id) || undefined,
    shipmentId: text(row.shipment_id) || text(row.id) || undefined,
    tracking: text(row.tracking_number) || undefined,
    external: text(row.external_order_id) || text(row.external_shipment_id) || null,
    status: text(row.status) || undefined,
    orderSn: text(row.order_sn) || null,
  };
}

/**
 * Result of DELETE /v1/fulfillment/inbounds/{id}. `absent` means HioBuy has no such notice, so the local
 * package can go. `not_editable` covers both "already cancelled" and "consolidated or shipped"; read the
 * package to tell them apart.
 */
export function interpretInboundCancel(input: { timedOut: boolean; httpStatus: number; payload: unknown }): "cancelled" | "absent" | "received" | "not_editable" | "retry" {
  if (input.timedOut) return "retry";
  if (input.httpStatus >= 200 && input.httpStatus < 300) return asRecord(input.payload)?.success === false ? "retry" : "cancelled";
  const { code } = errorParts(input.payload);
  if (input.httpStatus === 404 && (code === "INBOUND_NOT_FOUND" || code === "PACKAGE_NOT_FOUND" || !code)) return "absent";
  if (code === "INBOUND_ALREADY_RECEIVED") return "received";
  if (code === "INBOUND_NOT_EDITABLE") return "not_editable";
  return "retry";
}

function errorParts(payload: unknown) {
  const root = asRecord(payload);
  const error = asRecord(root?.error);
  const details = asRecord(error?.details);
  const retry = details?.retry_after_ms;
  return {
    code: text(error?.code) || text(root?.code) || text(root?.error_code),
    message: text(error?.message) || text(root?.message) || text(root?.msg) || "HioBuy returned an error.",
    requestId: text(error?.request_id) || text(root?.request_id),
    retryAfterMs: typeof retry === "number" && retry > 0 ? retry : null,
    successFalse: root?.success === false,
    existing: existingResource(payload),
  };
}

function adoptInbound(existing: ExistingResource | null, ourExternal: string, ourTracking: string): "adopt" | "review" {
  if (!existing?.packageId) return "review";
  const external = existing.external?.trim() || "";
  const tracking = (existing.tracking ?? "").toUpperCase();
  if (external && external !== ourExternal) return "review";
  if (tracking && tracking !== ourTracking.toUpperCase()) return "review";
  return "adopt";
}

function adoptShipment(existing: ExistingResource | null, ourExternal: string): "adopt" | "review" {
  const remoteId = existing?.shipmentId || existing?.packageId;
  if (!remoteId) return "review";
  const external = existing?.external?.trim() || "";
  if (external && external !== ourExternal) return "review";
  return "adopt";
}

/** An inbound-notice id and a warehouse package id are different resources. */
export function splitInboundIds(payload: unknown): { noticeId: string | null; warehousePackageId: string | null } {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  const status = canonicalRemoteStatus(text(data?.status) || text(root?.status));
  const noticeField = text(data?.inbound_id) || text(data?.notice_id) || text(data?.id) || text(root?.inbound_id) || text(root?.notice_id) || text(root?.id);
  const packageField = text(data?.package_id) || text(root?.package_id);
  const explicitWarehouse = text(data?.warehouse_package_id) || text(root?.warehouse_package_id);
  const receivedPackage = status === "RECEIVED" ? packageField : "";
  const warehousePackageId = explicitWarehouse || receivedPackage;
  const noticeId = noticeField || (status === "RECEIVED" ? "" : packageField);
  return {
    noticeId: noticeId || null,
    warehousePackageId: warehousePackageId && warehousePackageId !== noticeId ? warehousePackageId : status === "RECEIVED" ? warehousePackageId || null : null,
  };
}

export function interpretInboundResponse(input: { timedOut: boolean; httpStatus: number; payload: unknown; ourExternal: string; ourTracking: string }): SyncOutcome {
  if (input.timedOut) return { kind: "retry", errorClass: "transient", code: "TIMEOUT", message: "HioBuy did not respond.", retryAfterMs: null };
  const error = errorParts(input.payload);
  const root = asRecord(input.payload);
  if (input.httpStatus >= 200 && input.httpStatus < 300 && !error.successFalse) {
    const ids = splitInboundIds(input.payload);
    const remoteId = ids.noticeId || ids.warehousePackageId;
    if (!remoteId) return { kind: "review", code: "MISSING_REMOTE_ID", message: "HioBuy accepted the notice without an id." };
    return { kind: "synced", remoteId, remoteStatus: canonicalRemoteStatus(text(root?.status) || text(asRecord(root?.data)?.status)) ?? "PENDING", orderSn: null, noticeId: ids.noticeId, warehousePackageId: ids.warehousePackageId };
  }
  return classifyConflict(input.httpStatus, error, () => adoptInbound(error.existing, input.ourExternal, input.ourTracking), error.existing?.packageId, error.existing?.status);
}

export function interpretShipmentCreate(input: { timedOut: boolean; httpStatus: number; payload: unknown; ourExternal: string }): SyncOutcome {
  if (input.timedOut) return { kind: "retry", errorClass: "transient", code: "TIMEOUT", message: "HioBuy did not respond.", retryAfterMs: null };
  const error = errorParts(input.payload);
  const root = asRecord(input.payload);
  if (input.httpStatus >= 200 && input.httpStatus < 300 && !error.successFalse) {
    const remoteId = text(root?.id) || text(root?.shipment_id);
    if (!remoteId) return { kind: "review", code: "MISSING_REMOTE_ID", message: "HioBuy accepted the shipment without an id." };
    return { kind: "synced", remoteId, remoteStatus: canonicalRemoteStatus(text(root?.status)) ?? "PENDING", orderSn: text(root?.order_sn) || null };
  }
  if (error.code === "PACKAGE_ALREADY_CONSOLIDATED" || error.code === "PARCEL_NOT_FOUND" || error.code === "SHIPMENT_CREATE_EXCEPTION") {
    return { kind: "review", code: error.code, message: error.message };
  }
  return classifyConflict(input.httpStatus, error, () => adoptShipment(error.existing, input.ourExternal), error.existing?.shipmentId || error.existing?.packageId, error.existing?.status, error.existing?.orderSn);
}

export function interpretPayResponse(input: { timedOut: boolean; httpStatus: number; payload: unknown }): SyncOutcome {
  if (input.timedOut) return { kind: "retry", errorClass: "transient", code: "TIMEOUT", message: "HioBuy did not respond. The customer wallet was not changed.", retryAfterMs: null };
  const error = errorParts(input.payload);
  const root = asRecord(input.payload);
  if (error.code === "SHIPMENT_ALREADY_PAID") {
    const remoteId = error.existing?.shipmentId || text(root?.id) || "paid";
    return { kind: "synced", remoteId, remoteStatus: "WAIT_SHIP", orderSn: error.existing?.orderSn ?? null };
  }
  if (input.httpStatus >= 200 && input.httpStatus < 300 && !error.successFalse) {
    return { kind: "synced", remoteId: text(root?.id) || text(root?.shipment_id) || "paid", remoteStatus: canonicalRemoteStatus(text(root?.status)) ?? "WAIT_SHIP", orderSn: text(root?.order_sn) || null };
  }
  if (error.code === "SHIPMENT_NOT_READY_FOR_PAYMENT") {
    return { kind: "retry", errorClass: "transient", code: error.code, message: error.message, retryAfterMs: 60_000 };
  }
  const funds = /insufficient/i.test(error.code) || /insufficient/i.test(error.message);
  if (funds || error.successFalse) {
    return { kind: "failed", errorClass: "funds", code: error.code || "INSUFFICIENT_BALANCE", message: "HioBuy fulfillment payment failed. The customer was not charged again." };
  }
  return classifyConflict(input.httpStatus, error, () => "review", undefined, undefined);
}

function classifyConflict(
  httpStatus: number,
  error: ReturnType<typeof errorParts>,
  adopt: () => "adopt" | "review",
  remoteId: string | undefined,
  remoteStatus: string | undefined,
  orderSn?: string | null,
): SyncOutcome {
  const code = error.code || `HTTP_${httpStatus || 0}`;
  const message = redactSensitive(error.message);
  if (httpStatus === 401 || code === "INVALID_API_KEY") return { kind: "pause", code: code || "INVALID_API_KEY", message };
  if (httpStatus === 403 || code === "FULFILLMENT_MODE_NOT_SUPPORTED" || code === "WAREHOUSE_AUTH_INVALID") return { kind: "pause", code, message };
  if (httpStatus === 429) return { kind: "retry", errorClass: "rate_limit", code: code || "RATE_LIMITED", message, retryAfterMs: error.retryAfterMs };
  if (code === "IDEMPOTENCY_REQUEST_IN_PROGRESS") return { kind: "retry", errorClass: "transient", code, message, retryAfterMs: error.retryAfterMs ?? 5_000 };
  if (httpStatus >= 500 || httpStatus === 0) return { kind: "retry", errorClass: "transient", code, message, retryAfterMs: null };
  if (httpStatus === 409 && (code === "EXTERNAL_ORDER_ID_ALREADY_EXISTS" || code === "INBOUND_TRACKING_ALREADY_EXISTS" || code === "IDEMPOTENCY_CONFLICT")) {
    if (code === "IDEMPOTENCY_CONFLICT") return { kind: "review", code, message: "The same idempotency key was reused with different details." };
    if (adopt() === "adopt" && remoteId) {
      return { kind: "synced", remoteId, remoteStatus: canonicalRemoteStatus(remoteStatus) ?? "PENDING", orderSn: orderSn ?? null };
    }
    return { kind: "review", code, message: "HioBuy already has this tracking number under a different reference." };
  }
  if (httpStatus === 422 || httpStatus === 400) return { kind: "review", code, message };
  return { kind: "failed", errorClass: "unknown", code, message };
}

const KNOWN_PACKAGE_STATUS = new Set<string>(PACKAGE_LIFECYCLE);

const MAIN_RANK: Record<string, number> = {
  PENDING: 1,
  RECEIVED: 2,
  CONSOLIDATED: 3,
  SHIPPED: 4,
  DELIVERED: 5,
};

export type PackagePullRemote = {
  id: string;
  status: string;
  externalOrderId: string | null;
  condition: "NORMAL" | "EXCEPTION" | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  receivedAt: string | null;
};

export type PackagePullLocal = {
  packageStatus: string;
  conditionStatus: string;
  exceptionStatus: string;
  lockStatus: string;
  hiobuyPackageId: string | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  receivedAt: number | null;
  /** False while the package is on a shipment that has not left the warehouse. */
  shipmentDispatched?: boolean;
};

export type PackagePullDecision =
  | { result: "unchanged" }
  | { result: "needs_review"; reason: string }
  | {
      result: "updated";
      status: string;
      condition: "NORMAL" | "EXCEPTION";
      weightGrams: number | null;
      lengthMm: number | null;
      widthMm: number | null;
      heightMm: number | null;
      receivedAt: number | null;
      openException: boolean;
    };

function readCondition(row: Record<string, unknown>): "NORMAL" | "EXCEPTION" | null {
  const condition = asRecord(row.condition);
  const status = canonicalRemoteStatus(text(condition?.status));
  if (status === "NORMAL" || status === "EXCEPTION") return status;
  if (condition?.has_exception === true) return "EXCEPTION";
  if (condition?.has_exception === false) return "NORMAL";
  return null;
}

export function readFulfillmentPackageView(row: unknown): PackagePullRemote | null {
  const record = asRecord(row);
  if (!record) return null;
  const id = text(record.id) || text(record.package_id);
  const status = canonicalRemoteStatus(text(record.status));
  if (!id || !status || !KNOWN_PACKAGE_STATUS.has(status)) return null;
  const measure = measureFromWarehouse(record.warehouse);
  return {
    id,
    status,
    externalOrderId: text(record.external_order_id) || null,
    condition: readCondition(record),
    weightGrams: measure?.weightGrams ?? null,
    lengthMm: measure?.lengthMm ?? null,
    widthMm: measure?.widthMm ?? null,
    heightMm: measure?.heightMm ?? null,
    receivedAt: text(record.received_at) || null,
  };
}

export function interpretPackageDetail(input: { timedOut: boolean; httpStatus: number; payload: unknown }):
  | { kind: "ok"; package: PackagePullRemote; requestId: string | null }
  | { kind: "retry"; code: string; message: string }
  | { kind: "missing"; code: string; message: string }
  | { kind: "failed"; code: string; message: string } {
  if (input.timedOut) return { kind: "retry", code: "TIMEOUT", message: "HioBuy did not respond." };
  const error = errorParts(input.payload);
  if (input.httpStatus === 429) return { kind: "retry", code: error.code || "RATE_LIMITED", message: error.message };
  if (input.httpStatus === 404) return { kind: "missing", code: error.code || "PACKAGE_NOT_FOUND", message: "HioBuy has no package with the linked id." };
  if (input.httpStatus >= 500 || input.httpStatus === 0) return { kind: "retry", code: error.code || `HTTP_${input.httpStatus || 0}`, message: error.message };
  if (input.httpStatus >= 400 || error.successFalse) return { kind: "failed", code: error.code || `HTTP_${input.httpStatus}`, message: error.message };
  const root = asRecord(input.payload);
  const data = asRecord(root?.data) ?? root;
  const view = readFulfillmentPackageView(data);
  if (!view) return { kind: "failed", code: "INVALID_RESPONSE", message: "HioBuy returned a package without a usable status." };
  return { kind: "ok", package: view, requestId: error.requestId || text(root?.request_id) || null };
}

export function interpretPackageList(input: { timedOut: boolean; httpStatus: number; payload: unknown }):
  | { kind: "ok"; items: PackagePullRemote[]; page: number; totalPages: number; requestId: string | null }
  | { kind: "retry"; code: string; message: string }
  | { kind: "failed"; code: string; message: string } {
  if (input.timedOut) return { kind: "retry", code: "TIMEOUT", message: "HioBuy did not respond." };
  const error = errorParts(input.payload);
  if (input.httpStatus === 429) return { kind: "retry", code: error.code || "RATE_LIMITED", message: error.message };
  if (input.httpStatus >= 500 || input.httpStatus === 0) return { kind: "retry", code: error.code || `HTTP_${input.httpStatus || 0}`, message: error.message };
  if (input.httpStatus >= 400 || error.successFalse) return { kind: "failed", code: error.code || `HTTP_${input.httpStatus}`, message: error.message };
  const root = asRecord(input.payload);
  const rows = Array.isArray(root?.data) ? root.data : [];
  const pagination = asRecord(root?.pagination);
  const page = typeof pagination?.page === "number" ? pagination.page : 1;
  const totalPages = typeof pagination?.total_pages === "number" ? pagination.total_pages : 1;
  return {
    kind: "ok",
    items: rows.map((row) => readFulfillmentPackageView(row)).filter((row): row is PackagePullRemote => Boolean(row)),
    page,
    totalPages,
    requestId: error.requestId || text(root?.request_id) || null,
  };
}

function statusRegresses(stored: string, incoming: string) {
  const from = MAIN_RANK[stored];
  const to = MAIN_RANK[incoming];
  if (from != null && to != null) return to < from;
  if ((incoming === "PENDING" || incoming === "UNCLAIMED") && (stored === "CONSOLIDATED" || stored === "SHIPPED" || stored === "DELIVERED" || stored === "ARCHIVED" || stored === "DISCARDED")) return true;
  if (incoming === "RECEIVED" && (stored === "CONSOLIDATED" || stored === "SHIPPED" || stored === "DELIVERED" || stored === "ARCHIVED")) return true;
  if (incoming === "TRANSFERRING" && (stored === "CONSOLIDATED" || stored === "SHIPPED" || stored === "DELIVERED" || stored === "ARCHIVED" || stored === "DISCARDED")) return true;
  return false;
}

function keepMeasure(remote: number | null, local: number | null) {
  return remote != null && remote > 0 ? remote : local;
}

/** Apply a HioBuy package snapshot onto the linked local row. Missing remote fields stay as they are. */
export function decidePackagePull(local: PackagePullLocal, remote: PackagePullRemote, expectedExternal: string): PackagePullDecision {
  if (!local.hiobuyPackageId) return { result: "needs_review", reason: "No HioBuy package is linked, so this record was not queried." };
  if (remote.id !== local.hiobuyPackageId) return { result: "needs_review", reason: "The HioBuy package id does not match the linked package." };
  if (remote.externalOrderId && remote.externalOrderId !== expectedExternal) {
    return { result: "needs_review", reason: "This HioBuy package belongs to a different reference." };
  }
  const remoteStatus = local.shipmentDispatched === false && (remote.status === "SHIPPED" || remote.status === "DELIVERED") ? "CONSOLIDATED" : remote.status;
  if (!KNOWN_PACKAGE_STATUS.has(remoteStatus)) return { result: "needs_review", reason: "HioBuy returned a package status this app does not recognize." };
  const stillAtWarehouse = local.shipmentDispatched === false && remoteStatus === "CONSOLIDATED" && (local.packageStatus === "SHIPPED" || local.packageStatus === "DELIVERED");
  if (!stillAtWarehouse && statusRegresses(local.packageStatus, remoteStatus)) {
    return { result: "needs_review", reason: `HioBuy status ${remoteStatus} would move ${local.packageStatus} backwards.` };
  }
  if (local.lockStatus === "LOCKED" && (remoteStatus === "PENDING" || remoteStatus === "UNCLAIMED")) {
    return { result: "needs_review", reason: "This package is already in a local shipment, but HioBuy still reports it as not received." };
  }
  const condition = remote.condition ?? (local.conditionStatus === "EXCEPTION" ? "EXCEPTION" : "NORMAL");
  if (condition === "NORMAL" && local.exceptionStatus === "ACTION_REQUIRED") {
    return { result: "needs_review", reason: "HioBuy reports a normal condition while a local exception is still open." };
  }
  const receivedAt = local.receivedAt ?? (remote.receivedAt ? Date.parse(remote.receivedAt) : null);
  const next = {
    status: remoteStatus,
    condition,
    weightGrams: keepMeasure(remote.weightGrams, local.weightGrams),
    lengthMm: keepMeasure(remote.lengthMm, local.lengthMm),
    widthMm: keepMeasure(remote.widthMm, local.widthMm),
    heightMm: keepMeasure(remote.heightMm, local.heightMm),
    receivedAt: receivedAt != null && Number.isFinite(receivedAt) ? receivedAt : local.receivedAt,
  };
  const same =
    next.status === local.packageStatus &&
    next.condition === local.conditionStatus &&
    next.weightGrams === local.weightGrams &&
    next.lengthMm === local.lengthMm &&
    next.widthMm === local.widthMm &&
    next.heightMm === local.heightMm &&
    next.receivedAt === local.receivedAt;
  if (same) return { result: "unchanged" };
  return { result: "updated", ...next, openException: condition === "EXCEPTION" && local.exceptionStatus !== "ACTION_REQUIRED" };
}

const SHIPMENT_LIFE = new Set(["PENDING", "WAIT_PAYMENT", "WAIT_SHIP", "SHIPPED", "SIGNED", "CANCELLED"]);
const SHIPMENT_RANK: Record<string, number> = { PENDING: 1, WAIT_PAYMENT: 2, WAIT_SHIP: 3, SHIPPED: 4, SIGNED: 5 };
const PAYMENT_STATUS = new Set(["UNPAID", "PARTIAL", "PAID"]);
const INTERCEPT_STATUS = new Set(["REQUESTED", "PROCESSING", "INTERCEPTED", "FAILED"]);

export type ShipmentPullRemote = {
  id: string;
  status: string;
  externalShipmentId: string | null;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | null;
  interceptionStatus: "REQUESTED" | "PROCESSING" | "INTERCEPTED" | "FAILED" | null;
  interceptionKnown: boolean;
  trackingNumber: string | null;
};

export type ShipmentPullLocal = {
  hiobuyShipmentId: string | null;
  upstreamStatus: string | null;
  hiobuyPaymentStatus: string | null;
  interceptionStatus: string | null;
  trackingNumber: string | null;
};

export type ShipmentPullDecision =
  | { result: "unchanged" }
  | { result: "needs_review"; reason: string }
  | { result: "updated"; status: string; paymentStatus: string | null; interceptionStatus: string | null; trackingNumber: string | null };

export function readShipmentView(row: unknown): ShipmentPullRemote | null {
  const record = asRecord(row);
  if (!record) return null;
  const id = text(record.id) || text(record.shipment_id);
  const status = canonicalRemoteStatus(text(record.status));
  if (!id || !status || !SHIPMENT_LIFE.has(status)) return null;
  const payment = canonicalRemoteStatus(text(record.payment_status));
  const tracking = asRecord(record.international_tracking);
  const intercept = record.interception === null ? null : asRecord(record.interception);
  const interceptStatus = canonicalRemoteStatus(text(intercept?.status));
  return {
    id,
    status,
    externalShipmentId: text(record.external_shipment_id) || null,
    paymentStatus: payment && PAYMENT_STATUS.has(payment) ? (payment as "UNPAID" | "PARTIAL" | "PAID") : null,
    interceptionStatus: interceptStatus && INTERCEPT_STATUS.has(interceptStatus) ? (interceptStatus as "REQUESTED" | "PROCESSING" | "INTERCEPTED" | "FAILED") : null,
    interceptionKnown: "interception" in record,
    trackingNumber: text(tracking?.tracking_number) || text(record.international_tracking_number) || null,
  };
}

export type CarrierEvent = { at: string; title: string; location: string; code: string };

/** International tracking from a HioBuy shipment tracking response. Missing fields stay empty. */
export function readCarrierTracking(payload: unknown): { trackingNumber: string | null; carrier: string | null; events: CarrierEvent[] } {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  if (!data) return { trackingNumber: null, carrier: null, events: [] };
  const tracking = asRecord(data.international_tracking) ?? asRecord(data.tracking);
  const trackingNumber = text(tracking?.tracking_number) || text(data.international_tracking_number) || text(data.logistics_sn) || text(data.tracking_number) || null;
  const carrier = text(tracking?.carrier) || text(tracking?.carrier_name) || text(data.carrier) || null;
  const rows = Array.isArray(data.timeline) ? data.timeline : [];
  const events = rows.flatMap((row) => {
    const event = asRecord(row);
    const at = text(event?.occurred_at);
    const title = text(event?.title);
    if (!event || !at || !title) return [];
    const details = asRecord(event.details);
    const location = text(details?.station_name) || text(details?.facility_name) || "";
    return [{ at, title, location, code: text(event.code) || "" }];
  });
  return { trackingNumber, carrier, events };
}

export function interpretShipmentDetail(input: { timedOut: boolean; httpStatus: number; payload: unknown }):
  | { kind: "ok"; shipment: ShipmentPullRemote; requestId: string | null }
  | { kind: "retry"; code: string; message: string }
  | { kind: "missing"; code: string; message: string }
  | { kind: "failed"; code: string; message: string } {
  if (input.timedOut) return { kind: "retry", code: "TIMEOUT", message: "HioBuy did not respond." };
  const error = errorParts(input.payload);
  if (input.httpStatus === 429) return { kind: "retry", code: error.code || "RATE_LIMITED", message: error.message };
  if (input.httpStatus === 404) return { kind: "missing", code: error.code || "SHIPMENT_NOT_FOUND", message: "HioBuy has no shipment with the linked id." };
  if (input.httpStatus >= 500 || input.httpStatus === 0) return { kind: "retry", code: error.code || `HTTP_${input.httpStatus || 0}`, message: error.message };
  if (input.httpStatus >= 400 || error.successFalse) return { kind: "failed", code: error.code || `HTTP_${input.httpStatus}`, message: error.message };
  const root = asRecord(input.payload);
  const view = readShipmentView(asRecord(root?.data) ?? root);
  if (!view) return { kind: "failed", code: "INVALID_RESPONSE", message: "HioBuy returned a shipment without a usable status." };
  return { kind: "ok", shipment: view, requestId: error.requestId || text(root?.request_id) || null };
}

export function interpretShipmentList(input: { timedOut: boolean; httpStatus: number; payload: unknown }):
  | { kind: "ok"; items: ShipmentPullRemote[]; page: number; totalPages: number; requestId: string | null }
  | { kind: "retry"; code: string; message: string }
  | { kind: "failed"; code: string; message: string } {
  if (input.timedOut) return { kind: "retry", code: "TIMEOUT", message: "HioBuy did not respond." };
  const error = errorParts(input.payload);
  if (input.httpStatus === 429) return { kind: "retry", code: error.code || "RATE_LIMITED", message: error.message };
  if (input.httpStatus >= 500 || input.httpStatus === 0) return { kind: "retry", code: error.code || `HTTP_${input.httpStatus || 0}`, message: error.message };
  if (input.httpStatus >= 400 || error.successFalse) return { kind: "failed", code: error.code || `HTTP_${input.httpStatus}`, message: error.message };
  const root = asRecord(input.payload);
  const rows = Array.isArray(root?.data) ? root.data : [];
  const pagination = asRecord(root?.pagination);
  return {
    kind: "ok",
    items: rows.map((row) => readShipmentView(row)).filter((row): row is ShipmentPullRemote => Boolean(row)),
    page: typeof pagination?.page === "number" ? pagination.page : 1,
    totalPages: typeof pagination?.total_pages === "number" ? pagination.total_pages : 1,
    requestId: error.requestId || text(root?.request_id) || null,
  };
}

/** Apply a HioBuy shipment snapshot. A failed read must not call this. */
export function decideShipmentPull(local: ShipmentPullLocal, remote: ShipmentPullRemote, expectedExternal: string): ShipmentPullDecision {
  if (!local.hiobuyShipmentId) return { result: "needs_review", reason: "No HioBuy shipment is linked, so this record was not queried." };
  if (remote.id !== local.hiobuyShipmentId) return { result: "needs_review", reason: "The HioBuy shipment id does not match the linked shipment." };
  if (remote.externalShipmentId && remote.externalShipmentId !== expectedExternal) {
    return { result: "needs_review", reason: "This HioBuy shipment belongs to a different reference." };
  }
  if (!SHIPMENT_LIFE.has(remote.status)) return { result: "needs_review", reason: "HioBuy returned a shipment status this app does not recognize." };
  const stored = canonicalRemoteStatus(local.upstreamStatus);
  const storedRank = stored ? SHIPMENT_RANK[stored] : null;
  const nextRank = SHIPMENT_RANK[remote.status];
  if (stored === "SIGNED" && remote.status !== "SIGNED") return { result: "needs_review", reason: "HioBuy would move a delivered shipment backwards." };
  if (stored === "CANCELLED" && remote.status !== "CANCELLED") return { result: "needs_review", reason: "HioBuy would reopen a cancelled shipment." };
  if (remote.status === "CANCELLED" && storedRank != null && storedRank > SHIPMENT_RANK.WAIT_PAYMENT) {
    return { result: "needs_review", reason: "HioBuy reported a cancellation after the shipment was already ready to ship." };
  }
  if (storedRank != null && nextRank != null && nextRank < storedRank) {
    return { result: "needs_review", reason: `HioBuy status ${remote.status} would move ${stored} backwards.` };
  }
  const paymentStatus = remote.paymentStatus ?? local.hiobuyPaymentStatus;
  const interceptionStatus = remote.interceptionKnown ? remote.interceptionStatus : local.interceptionStatus;
  const trackingNumber = remote.trackingNumber || local.trackingNumber;
  const same = remote.status === stored && paymentStatus === local.hiobuyPaymentStatus && interceptionStatus === local.interceptionStatus && trackingNumber === local.trackingNumber;
  if (same) return { result: "unchanged" };
  return { result: "updated", status: remote.status, paymentStatus, interceptionStatus, trackingNumber };
}

export type RemoteMedia = { id: string; type: string; url: string; label: string };

export type RemoteCarton = {
  id: string;
  code: string;
  status: string;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  trackingNumber: string | null;
  packageRemoteIds: string[];
};

function readMediaFile(value: unknown): RemoteMedia | null {
  const row = asRecord(value);
  if (!row) return null;
  const url = text(row.url) || text(row.file_url) || text(row.href);
  if (!/^https?:\/\//i.test(url)) return null;
  const type = (text(row.type) || "PHOTO").toUpperCase();
  const id = text(row.id) || url;
  const label = text(row.name) || text(row.label) || type.replaceAll("_", " ");
  return { id, type, url, label };
}

function uniqueMedia(files: RemoteMedia[]) {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.url)) return false;
    seen.add(file.url);
    return true;
  });
}

/** Inbound, service, and exception photos from a package detail payload. List rows do not include these. */
export function readPackageMedia(payload: unknown): RemoteMedia[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  if (!data) return [];
  const files: RemoteMedia[] = [];
  for (const key of ["warehouse_files", "files"] as const) {
    if (Array.isArray(data[key])) files.push(...data[key].map(readMediaFile).filter((file): file is RemoteMedia => Boolean(file)));
  }
  const services = Array.isArray(data.services) ? data.services : [];
  for (const service of services) {
    const result = asRecord(asRecord(service)?.result);
    const nested = Array.isArray(result?.files) ? result.files : [];
    files.push(...nested.map(readMediaFile).filter((file): file is RemoteMedia => Boolean(file)));
  }
  const exceptions = asRecord(data.condition)?.exceptions;
  for (const exception of Array.isArray(exceptions) ? exceptions : []) {
    const attached = asRecord(exception)?.files;
    if (Array.isArray(attached)) files.push(...attached.map(readMediaFile).filter((file): file is RemoteMedia => Boolean(file)));
  }
  return uniqueMedia(files);
}

/** Packing photos, videos, and outbound cartons from a shipment detail payload. */
export function readShipmentWarehouse(payload: unknown): { files: RemoteMedia[]; cartons: RemoteCarton[] } {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  if (!data) return { files: [], cartons: [] };
  const files = uniqueMedia((Array.isArray(data.files) ? data.files : []).map(readMediaFile).filter((file): file is RemoteMedia => Boolean(file)));
  const boxes = Array.isArray(data.boxes) ? data.boxes : [];
  const cartons: RemoteCarton[] = [];
  boxes.forEach((box, index) => {
    const row = asRecord(box);
    if (!row) return;
    const measure = measureFromWarehouse(row);
    const tracking = asRecord(row.tracking);
    const code = text(row.box_no) || text(row.code) || text(row.id) || `box-${index + 1}`;
    const packageRemoteIds = Array.isArray(row.source_package_ids) ? row.source_package_ids.map((item) => text(item)).filter(Boolean) : [];
    cartons.push({
      id: text(row.id) || code,
      code,
      status: canonicalRemoteStatus(text(row.status)) || "PACKED",
      weightGrams: measure?.weightGrams ?? null,
      lengthMm: measure?.lengthMm ?? null,
      widthMm: measure?.widthMm ?? null,
      heightMm: measure?.heightMm ?? null,
      trackingNumber: text(tracking?.tracking_number) || null,
      packageRemoteIds,
    });
  });
  return { files, cartons };
}

export function readSourcePackageIds(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  const rows = Array.isArray(data?.source_packages) ? data.source_packages : [];
  return rows.map((row) => text(asRecord(row)?.id)).filter(Boolean);
}

export function shipmentIsPacked(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  const times = asRecord(data?.times);
  if (text(times?.packed_at)) return true;
  const status = canonicalRemoteStatus(text(data?.status));
  return status === "WAIT_PAYMENT" || status === "WAIT_SHIP" || status === "SHIPPED" || status === "SIGNED";
}

export function measureFromWarehouse(warehouse: unknown) {
  const row = asRecord(warehouse);
  if (!row) return null;
  const weight = asRecord(row.weight);
  const dims = asRecord(row.dimensions);
  const value = typeof weight?.value === "number" ? weight.value : Number(weight?.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = text(weight?.unit).toLowerCase() || "kg";
  const grams = unit === "g" ? Math.round(value) : Math.round(value * 1000);
  const side = (key: string) => {
    const raw = dims?.[key];
    const amount = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const dimUnit = text(dims?.unit).toLowerCase() || "cm";
    return dimUnit === "mm" ? Math.round(amount) : Math.round(amount * 10);
  };
  return { weightGrams: grams, lengthMm: side("length"), widthMm: side("width"), heightMm: side("height") };
}

export function payableCnyFen(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  const due = asRecord(data?.amount_due);
  const total = asRecord(data?.total);
  const payable = asRecord(total?.payable) ?? asRecord(total?.payment) ?? due;
  const amount = payable?.amount;
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}
