import { describe, expect, it } from "vitest";
import {
  afterCredentialChange,
  allowRemoteCreate,
  canManualRetry,
  classifyPackageHistory,
  classifyShipmentHistory,
  dispatchDecision,
  enqueueInbound,
  enqueueShipment,
  explainPackageSyncIssue,
  externalPackageRef,
  hiobuyPayReady,
  inboundNoticeBody,
  splitInboundIds,
  interpretInboundResponse,
  interpretPayResponse,
  interpretShipmentCreate,
  decidePackagePull,
  decideShipmentPull,
  readCarrierTracking,
  interpretPackageDetail,
  interpretPackageList,
  readPackageMedia,
  interpretInboundCancel,
  readShipmentWarehouse,
  readSourcePackageIds,
  shipmentIsPacked,
  localPackageStatusAfterInboundCreate,
  nextRetryAt,
  packageCanSync,
  packageSyncLabel,
  readyForPaymentDecision,
  redactSensitive,
  shipmentCreateReady,
  shouldAutoEnqueueInbound,
  syncListLabel,
  verifyHioBuySignature,
  walletAfterHiobuyPayFailure,
  webhookDisposition,
} from "./fulfillment-sync";

const address = {
  name: "Alex Morgan",
  phone: "+12025550123",
  countryCode: "US",
  state: "New York",
  city: "New York",
  postalCode: "10001",
  addressLine1: "123 Example Ave",
};

describe("fulfillment sync", () => {
  it("keeps a package local when no API key is connected", () => {
    expect(enqueueInbound(false)).toBe("local_only");
  });

  it("keeps a shipment local when no API key is connected", () => {
    expect(enqueueShipment(false, true)).toBe("local_only");
  });

  it("classifies historical rows after the first connection", () => {
    expect(classifyPackageHistory({ remoteId: null, packageStatus: "PENDING", disposition: "NONE" })).toBe("candidate");
    expect(classifyShipmentHistory({ remoteId: null, status: "CONSOLIDATING", packagesReady: true })).toBe("candidate");
    expect(classifyPackageHistory({ remoteId: "pkg_1", packageStatus: "PENDING", disposition: "NONE" })).toBe("already_linked");
  });

  it("stores the remote package id without marking the parcel received", () => {
    const outcome = interpretInboundResponse({
      timedOut: false,
      httpStatus: 201,
      payload: { success: true, package_id: "pkg_1", status: "pending_receive" },
      ourExternal: externalPackageRef("local"),
      ourTracking: "YT1",
    });
    expect(outcome.kind).toBe("synced");
    expect(localPackageStatusAfterInboundCreate("PENDING")).toBe("PENDING");
    expect(splitInboundIds({ package_id: "pkg_1", status: "pending_receive" })).toEqual({ noticeId: "pkg_1", warehousePackageId: null });
    expect(splitInboundIds({ id: "inb_1", warehouse_package_id: "wh_9", status: "pending_receive" })).toEqual({ noticeId: "inb_1", warehousePackageId: "wh_9" });
    expect(splitInboundIds({ id: "inb_1", package_id: "wh_9", status: "received" }).warehousePackageId).toBe("wh_9");
    expect(inboundNoticeBody({ tracking: "YT1", courier: "YTO", externalRef: "pkg_local", declaredValueFen: 2500, productName: "Shirt", quantity: 1 }).package_count).toBe(1);
  });

  it("sends a validation failure to review instead of retrying forever", () => {
    const outcome = interpretInboundResponse({
      timedOut: false,
      httpStatus: 422,
      payload: { error: { code: "INVALID_TRACKING_NUMBER", message: "Bad tracking" } },
      ourExternal: "pkg_local",
      ourTracking: "BAD",
    });
    expect(outcome.kind).toBe("review");
  });

  it("submits a shipment only after every package is received remotely", () => {
    expect(
      shipmentCreateReady({
        connected: true,
        paused: false,
        localStatus: "CONSOLIDATING",
        remoteShipmentId: null,
        channelCode: "US-AIR",
        address,
        packages: [{ remoteId: "pkg_1", remoteStatus: "RECEIVED" }],
      }).ready,
    ).toBe(true);
    expect(enqueueShipment(true, true)).toBe("pending");
  });

  it("does not create a remote shipment while a package is still pending", () => {
    const decision = shipmentCreateReady({
      connected: true,
      paused: false,
      localStatus: "CONSOLIDATING",
      remoteShipmentId: null,
      channelCode: "US-AIR",
      address,
      packages: [{ remoteId: "pkg_1", remoteStatus: "PENDING" }],
    });
    expect(decision.ready).toBe(false);
    expect(enqueueShipment(true, false)).toBe("waiting");
  });

  it("refuses a second create when the remote id is already stored", () => {
    expect(allowRemoteCreate("115", "synced")).toBe(false);
    expect(allowRemoteCreate(null, "pending")).toBe(true);
    const again = interpretInboundResponse({
      timedOut: false,
      httpStatus: 409,
      payload: {
        error: {
          code: "EXTERNAL_ORDER_ID_ALREADY_EXISTS",
          message: "External order id already exists",
          details: { existing_resource: { package_id: "427", tracking_number: "YT1", external_order_id: "pkg_local", status: "PENDING" } },
        },
      },
      ourExternal: "pkg_local",
      ourTracking: "YT1",
    });
    expect(again).toMatchObject({ kind: "synced", remoteId: "427" });
  });

  it("adopts the remote id when a timeout is followed by a matching conflict", () => {
    const timeout = interpretShipmentCreate({ timedOut: true, httpStatus: 0, payload: null, ourExternal: "shp_local" });
    expect(timeout.kind).toBe("retry");
    const recovered = interpretShipmentCreate({
      timedOut: false,
      httpStatus: 409,
      payload: {
        error: {
          code: "EXTERNAL_ORDER_ID_ALREADY_EXISTS",
          details: { existing_resource: { shipment_id: "115", external_shipment_id: "shp_local", order_sn: "JIYUNRI1349", status: "PENDING" } },
        },
      },
      ourExternal: "shp_local",
    });
    expect(recovered).toMatchObject({ kind: "synced", remoteId: "115", orderSn: "JIYUNRI1349" });
  });

  it("pauses on 401 and 403, and retries 429 and 5xx", () => {
    expect(interpretInboundResponse({ timedOut: false, httpStatus: 401, payload: { error: { code: "INVALID_API_KEY", message: "no" } }, ourExternal: "pkg_local", ourTracking: "YT1" }).kind).toBe("pause");
    expect(interpretInboundResponse({ timedOut: false, httpStatus: 403, payload: { error: { code: "FULFILLMENT_MODE_NOT_SUPPORTED", message: "no" } }, ourExternal: "pkg_local", ourTracking: "YT1" }).kind).toBe("pause");
    expect(interpretInboundResponse({ timedOut: false, httpStatus: 429, payload: { error: { code: "RATE_LIMITED", message: "slow" } }, ourExternal: "pkg_local", ourTracking: "YT1" })).toMatchObject({ kind: "retry", errorClass: "rate_limit" });
    expect(interpretInboundResponse({ timedOut: false, httpStatus: 502, payload: { error: { message: "down" } }, ourExternal: "pkg_local", ourTracking: "YT1" })).toMatchObject({ kind: "retry", errorClass: "transient" });
    expect(nextRetryAt(2, 1_000)).toBeGreaterThan(1_000);
    expect(nextRetryAt(8, 1_000)).toBeNull();
  });

  it("requeues auth failures after a new key and reviews tasks when the warehouse changes", () => {
    expect(afterCredentialChange({ accessOk: true, warehouseIdChanged: false })).toMatchObject({ clearPause: true, requeueAuthFailures: true, reviewOpenTasks: false });
    expect(afterCredentialChange({ accessOk: true, warehouseIdChanged: true }).reviewOpenTasks).toBe(true);
    expect(canManualRetry("failed", "auth")).toBe(true);
    expect(canManualRetry("needs_review", "conflict")).toBe(false);
  });

  it("ignores a duplicate webhook and a stale status", async () => {
    expect(webhookDisposition({ signatureOk: true, duplicate: true, incomingRank: 2, storedRank: 2 })).toBe("duplicate");
    expect(webhookDisposition({ signatureOk: true, duplicate: false, incomingRank: 1, storedRank: 2 })).toBe("stale");
    expect(webhookDisposition({ signatureOk: false, duplicate: false, incomingRank: 2, storedRank: 1 })).toBe("reject");
    const body = JSON.stringify({ id: "evt_1", type: "package.received" });
    const stamped = 1_700_000_000;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_test"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${stamped}.${body}`)));
    const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await expect(verifyHioBuySignature(body, `t=${stamped},v1=${hex}`, "whsec_test", stamped)).resolves.toBe(true);
    await expect(verifyHioBuySignature(body, `t=${stamped},v1=${hex}`, "whsec_other", stamped)).resolves.toBe(false);
  });

  it("skips cancelled and completed history", () => {
    expect(classifyPackageHistory({ remoteId: null, packageStatus: "SHIPPED", disposition: "NONE" })).toBe("skipped");
    expect(classifyShipmentHistory({ remoteId: null, status: "CANCELLED", packagesReady: true })).toBe("skipped");
    expect(classifyShipmentHistory({ remoteId: null, status: "DELIVERED", packagesReady: true })).toBe("skipped");
    expect(classifyShipmentHistory({ remoteId: null, status: "TO_PAY", packagesReady: true })).toBe("needs_review");
  });

  it("leaves the customer wallet unchanged when HioBuy payment fails", () => {
    const failed = interpretPayResponse({
      timedOut: false,
      httpStatus: 402,
      payload: { success: false, error: { code: "INSUFFICIENT_BALANCE", message: "insufficient fulfillment balance" } },
    });
    expect(failed).toMatchObject({ kind: "failed", errorClass: "funds" });
    expect(walletAfterHiobuyPayFailure(32680)).toBe(32680);
    expect(hiobuyPayReady({ customerPaid: true, remoteId: "115", remoteStatus: "PENDING", paymentStatus: "UNPAID" }).ready).toBe(false);
    expect(hiobuyPayReady({ customerPaid: true, remoteId: "115", remoteStatus: "WAIT_PAYMENT", paymentStatus: "UNPAID" }).ready).toBe(true);
    expect(hiobuyPayReady({ customerPaid: false, remoteId: "115", remoteStatus: "WAIT_PAYMENT", paymentStatus: "UNPAID" }).ready).toBe(false);
    expect(hiobuyPayReady({ customerPaid: true, remoteId: "115", remoteStatus: "WAIT_PAYMENT", paymentStatus: "PAID" }).already).toBe(true);
    expect(hiobuyPayReady({ customerPaid: true, remoteId: "115", remoteStatus: "WAIT_SHIP", paymentStatus: "PAID" }).already).toBe(true);
    expect(hiobuyPayReady({ customerPaid: true, remoteId: "115", remoteStatus: "WAIT_PAYMENT", paymentStatus: "PARTIAL" }).ready).toBe(false);
    expect(interpretPayResponse({ timedOut: true, httpStatus: 0, payload: null })).toMatchObject({ kind: "retry", code: "TIMEOUT" });
    expect(interpretPayResponse({ timedOut: false, httpStatus: 409, payload: { error: { code: "SHIPMENT_ALREADY_PAID", details: { existing_resource: { shipment_id: "115" } } } } }).kind).toBe("synced");
  });

  it("reads an international tracking number and the newest carrier events", () => {
    const parsed = readCarrierTracking({
      data: {
        status: "SHIPPED",
        international_tracking: { tracking_number: "CJ123456789", carrier: "CJ" },
        timeline: [
          { code: "PICKUP_STATION_ARRIVED", status: "SHIPPED", title: "Arrived at station", occurred_at: "2026-10-17T01:00:00Z", details: { station_name: "Los Angeles" } },
          { code: "SHIPMENT_DISPATCHED", status: "SHIPPED", title: "Dispatched", occurred_at: "2026-10-16T01:00:00Z", details: {} },
        ],
      },
    });
    expect(parsed.trackingNumber).toBe("CJ123456789");
    expect(parsed.carrier).toBe("CJ");
    expect(parsed.events[0]).toMatchObject({ title: "Arrived at station", location: "Los Angeles" });
    expect(readCarrierTracking({ data: { status: "SHIPPED", timeline: [] } }).events).toEqual([]);
  });

  it("queues a new pre-alert only when auto-sync and warehouse authorization are both on", () => {
    expect(shouldAutoEnqueueInbound({ auto: true, connected: true, paused: false })).toBe("pending");
    expect(shouldAutoEnqueueInbound({ auto: true, connected: false, paused: false })).toBe("local_only");
    expect(shouldAutoEnqueueInbound({ auto: false, connected: true, paused: false })).toBe("local_only");
    expect(shouldAutoEnqueueInbound({ auto: true, connected: true, paused: true })).toBe("local_only");
  });

  it("labels package sync separately and refuses a second inbound for a synced package", () => {
    expect(packageSyncLabel({ connected: false, taskStatus: null, remoteId: null })).toBe("Not Connected");
    expect(packageSyncLabel({ connected: true, taskStatus: "pending", remoteId: null })).toBe("Pending");
    expect(packageSyncLabel({ connected: true, taskStatus: "failed", remoteId: null })).toBe("Failed");
    expect(packageSyncLabel({ connected: true, taskStatus: "synced", remoteId: "pkg_1" })).toBe("Synced");
    expect(packageSyncLabel({ connected: true, taskStatus: "candidate", remoteId: null })).toBe("Not synced");
    expect(packageSyncLabel({ connected: true, taskStatus: "needs_review", remoteId: null })).toBe("Needs review");
    expect(packageCanSync({ packageStatus: "PENDING", taskStatus: null, remoteId: null })).toBe(true);
    expect(packageCanSync({ packageStatus: "PENDING", taskStatus: "failed", remoteId: null })).toBe(true);
    expect(packageCanSync({ packageStatus: "PENDING", taskStatus: "needs_review", remoteId: null })).toBe(false);
    expect(packageCanSync({ packageStatus: "PENDING", taskStatus: "synced", remoteId: "pkg_1" })).toBe(false);
    expect(packageCanSync({ packageStatus: "SHIPPED", taskStatus: null, remoteId: null })).toBe(false);
    expect(explainPackageSyncIssue("INBOUND_TRACKING_ALREADY_EXISTS", "raw")).toMatch(/not created again/);
  });

  it("labels sync state separately from warehouse status", () => {
    expect(syncListLabel(null)).toBe("Not linked");
    expect(syncListLabel("waiting")).toBe("Pending");
    expect(syncListLabel("syncing")).toBe("Syncing");
    expect(syncListLabel("synced")).toBe("Synced");
    expect(syncListLabel("failed")).toBe("Failed");
    expect(syncListLabel("candidate")).toBe("Needs review");
    expect(readyForPaymentDecision({ localStatus: "CONSOLIDATING", currentDueFen: null, nextUsdFen: 1890 })).toEqual({ kind: "bill", usdFen: 1890 });
    expect(readyForPaymentDecision({ localStatus: "TO_PAY", currentDueFen: 1890, nextUsdFen: 2000 }).kind).toBe("review");
    expect(dispatchDecision("TO_PAY")).toBe("review");
    expect(dispatchDecision("READY_TO_SHIP")).toBe("ship");
    expect(redactSensitive("Bearer sk_live_secret token=abc")).not.toContain("sk_live_secret");
  });

  it("pulls warehouse status without inventing missing measurements or walking status backwards", () => {
    const local = {
      packageStatus: "PENDING",
      conditionStatus: "NORMAL",
      exceptionStatus: "NONE",
      lockStatus: "AVAILABLE",
      hiobuyPackageId: "pkg_1",
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      receivedAt: null,
    };
    const remote = {
      id: "pkg_1",
      status: "RECEIVED",
      externalOrderId: "pkg_local",
      condition: "NORMAL" as const,
      weightGrams: 2350,
      lengthMm: 420,
      widthMm: 300,
      heightMm: 180,
      receivedAt: "2026-08-16T08:05:00Z",
    };
    const updated = decidePackagePull(local, remote, "pkg_local");
    expect(updated.result).toBe("updated");
    if (updated.result === "updated") {
      expect(updated.status).toBe("RECEIVED");
      expect(updated.weightGrams).toBe(2350);
    }
    expect(decidePackagePull({ ...local, packageStatus: "SHIPPED", weightGrams: 2350, lengthMm: 420, widthMm: 300, heightMm: 180, receivedAt: 1 }, { ...remote, status: "PENDING" }, "pkg_local").result).toBe("needs_review");
    expect(decidePackagePull({ ...local, hiobuyPackageId: null }, remote, "pkg_local").result).toBe("needs_review");
    expect(decidePackagePull(local, { ...remote, id: "pkg_other", externalOrderId: "pkg_someone_else" }, "pkg_local").result).toBe("needs_review");
    const again = decidePackagePull(
      { ...local, packageStatus: "RECEIVED", weightGrams: 2350, lengthMm: 420, widthMm: 300, heightMm: 180, receivedAt: Date.parse(remote.receivedAt) },
      remote,
      "pkg_local",
    );
    expect(again.result).toBe("unchanged");
    const partial = decidePackagePull(
      { ...local, packageStatus: "RECEIVED", weightGrams: 2350, lengthMm: 420, widthMm: 300, heightMm: 180, receivedAt: Date.parse(remote.receivedAt) },
      { ...remote, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null },
      "pkg_local",
    );
    expect(partial.result).toBe("unchanged");
    const exception = decidePackagePull(local, { ...remote, condition: "EXCEPTION" }, "pkg_local");
    expect(exception.result).toBe("updated");
    if (exception.result === "updated") expect(exception.condition).toBe("EXCEPTION");
    expect(decidePackagePull({ ...local, packageStatus: "RECEIVED" }, { ...remote, status: "CONSOLIDATED" }, "pkg_local").result).toBe("updated");
    expect(decidePackagePull({ ...local, packageStatus: "CONSOLIDATED" }, { ...remote, status: "SHIPPED" }, "pkg_local").result).toBe("updated");
    const held = decidePackagePull({ ...local, packageStatus: "SHIPPED", shipmentDispatched: false }, { ...remote, status: "SHIPPED" }, "pkg_local");
    expect(held.result).toBe("updated");
    if (held.result === "updated") expect(held.status).toBe("CONSOLIDATED");
    expect(decidePackagePull({ ...local, packageStatus: "SHIPPED" }, { ...remote, status: "DELIVERED" }, "pkg_local").result).toBe("updated");
  });

  it("reads package list and detail fields the HioBuy API actually returns", () => {
    const list = interpretPackageList({
      timedOut: false,
      httpStatus: 200,
      payload: {
        data: [
          {
            id: "pkg_1",
            status: "RECEIVED",
            external_order_id: "pkg_local",
            tracking_number: "SF1",
            warehouse: { weight: { value: 1.2, unit: "kg" }, dimensions: { length: 10, width: 8, height: 4, unit: "cm" } },
            condition: { status: "EXCEPTION", has_exception: true },
            received_at: "2026-08-16T08:05:00Z",
          },
        ],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
        request_id: "req_1",
      },
    });
    expect(list.kind).toBe("ok");
    if (list.kind === "ok") {
      expect(list.items[0]?.status).toBe("RECEIVED");
      expect(list.items[0]?.condition).toBe("EXCEPTION");
      expect(list.items[0]?.weightGrams).toBe(1200);
    }
    const heldShipment = decideShipmentPull(
      { hiobuyShipmentId: "115", upstreamStatus: "WAIT_SHIP", hiobuyPaymentStatus: "UNPAID", interceptionStatus: null, trackingNumber: null },
      { id: "115", status: "SHIPPED", externalShipmentId: "shp_local", paymentStatus: "PAID", interceptionStatus: null, interceptionKnown: true, trackingNumber: "SF1" },
      "shp_local",
    );
    expect(heldShipment.result).toBe("updated");
    if (heldShipment.result === "updated") {
      expect(heldShipment.status).toBe("SHIPPED");
      expect(heldShipment.paymentStatus).toBe("PAID");
      expect(heldShipment.trackingNumber).toBe("SF1");
    }
    expect(decideShipmentPull(
      { hiobuyShipmentId: "115", upstreamStatus: "SIGNED", hiobuyPaymentStatus: "PAID", interceptionStatus: null, trackingNumber: "SF1" },
      { id: "115", status: "PENDING", externalShipmentId: "shp_local", paymentStatus: null, interceptionStatus: null, interceptionKnown: false, trackingNumber: null },
      "shp_local",
    ).result).toBe("needs_review");
    expect(decideShipmentPull(
      { hiobuyShipmentId: null, upstreamStatus: null, hiobuyPaymentStatus: null, interceptionStatus: null, trackingNumber: null },
      { id: "115", status: "PENDING", externalShipmentId: null, paymentStatus: "UNPAID", interceptionStatus: null, interceptionKnown: false, trackingNumber: null },
      "shp_local",
    ).result).toBe("needs_review");
    expect(readPackageMedia({ warehouse_files: [{ id: "f1", type: "INBOUND", url: "https://cdn.example/in.jpg" }], services: [{ result: { files: [{ url: "https://cdn.example/vas.jpg", type: "PHOTO" }] } }] }).map((file) => file.url)).toEqual(["https://cdn.example/in.jpg", "https://cdn.example/vas.jpg"]);
    expect(readPackageMedia({ warehouse_files: [], condition: { exceptions: [{ type: "DAMAGED", files: [{ url: "https://cdn.example/damage.jpg" }] }] } }).map((file) => file.url)).toEqual(["https://cdn.example/damage.jpg"]);
    const warehouse = readShipmentWarehouse({
      files: [{ id: "file_1", type: "PACKING_VIDEO", url: "https://cdn.example/pack.mp4" }],
      boxes: [{ id: "box_1", box_no: "JIYUN-1", status: "SHIPPED", weight: { value: 1.2, unit: "kg" }, dimensions: { length: 10, width: 8, height: 4, unit: "cm" }, tracking: { tracking_number: "1Z1" } }],
    });
    expect(warehouse.files[0]?.type).toBe("PACKING_VIDEO");
    expect(warehouse.cartons[0]).toMatchObject({ code: "JIYUN-1", weightGrams: 1200, trackingNumber: "1Z1", packageRemoteIds: [] });
    expect(shipmentIsPacked({ status: "WAIT_PAYMENT", times: { packed_at: "2026-10-17" } })).toBe(true);
    expect(readSourcePackageIds({ source_packages: [{ id: "722" }] })).toEqual(["722"]);
    expect(interpretPackageDetail({ timedOut: true, httpStatus: 0, payload: null }).kind).toBe("retry");
    expect(interpretPackageDetail({ timedOut: false, httpStatus: 200, payload: { id: "pkg_1", status: "SHIPPED", condition: { status: "NORMAL", has_exception: false } } }).kind).toBe("ok");
  });

  it("reads an inbound cancel response", () => {
    const err = (code: string) => ({ error: { code, message: code } });
    expect(interpretInboundCancel({ timedOut: false, httpStatus: 200, payload: { success: true, status: "cancelled" } })).toBe("cancelled");
    expect(interpretInboundCancel({ timedOut: false, httpStatus: 404, payload: err("INBOUND_NOT_FOUND") })).toBe("absent");
    expect(interpretInboundCancel({ timedOut: false, httpStatus: 409, payload: err("INBOUND_ALREADY_RECEIVED") })).toBe("received");
    expect(interpretInboundCancel({ timedOut: false, httpStatus: 409, payload: err("INBOUND_NOT_EDITABLE") })).toBe("not_editable");
    expect(interpretInboundCancel({ timedOut: false, httpStatus: 401, payload: err("INVALID_API_KEY") })).toBe("retry");
    expect(interpretInboundCancel({ timedOut: true, httpStatus: 0, payload: null })).toBe("retry");
  });
});
