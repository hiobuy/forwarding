# Cancellation and interception

> Status: Implemented

## Purpose

Stop a shipment before the warehouse packs it, or ask HioBuy to intercept after it is ready to ship or already shipped. Interception does not replace the shipment lifecycle.

## Before you start

Customer cancel in the app is allowed only while `can_cancel` is true and local status is `CONSOLIDATING`. The API error is `CANCEL_NOT_ALLOWED` once packing has started.

Remote cancel is allowed for HioBuy `PENDING` or `WAIT_PAYMENT`.
Remote intercept is allowed for HioBuy `WAIT_SHIP` or `SHIPPED`.

## Steps

### Customer cancel

1. The customer calls `POST /api/shipments/:id/cancel` (`cancelShipment` in `server/data.ts`).
2. Local status becomes `CANCELLED`. Linked packages that are still `CONSOLIDATED` return to `RECEIVED` and `AVAILABLE`.
3. `noteShipmentCancelled` runs.
4. If no `hiobuy_shipment_id` exists, a not-yet-synced create task is marked `skipped`.
5. If the remote status is `PENDING`, `WAIT_PAYMENT`, or still empty, a `shipment_cancel` task is queued.
6. If HioBuy has moved past payment, the cancel task is `needs_review` and is not sent as a normal cancel.

The cancel body must include `cancel_reason`. The client sends it from `cancelFulfillmentShipment`.

### Admin intercept

1. `POST /api/admin/shipments/:id/intercept` with a reason and remark.
2. The server calls `POST /v1/fulfillment/shipments/{id}/intercept`.
3. Success sets `interception_status=REQUESTED` only. `upstream_status` stays `WAIT_SHIP` or `SHIPPED`.
4. The next pull copies `PROCESSING`, `INTERCEPTED`, or `FAILED` when the detail includes interception.

## HioBuy API

- `POST /v1/fulfillment/shipments/{id}/cancel`
- `POST /v1/fulfillment/shipments/{id}/intercept`

Official intercept errors include `SHIPMENT_NOT_FOUND`, `SHIPMENT_NOT_INTERCEPTABLE`, and `SHIPMENT_INTERCEPTION_ALREADY_REQUESTED`. This app surfaces the upstream message and does not change shipment status when intercept is rejected.

## Local data

- Cancel: `shipments.status=CANCELLED`, package lock cleared, create or cancel task updated
- Intercept: `shipments.interception_status` only, plus a sync attempt

Neither path refunds the customer wallet by itself. Refunds are a separate admin action. See [Exceptions and refunds](exceptions-refunds.md).

## HioBuy status

Cancel targets `PENDING` and `WAIT_PAYMENT` and ends at `CANCELLED`.
Intercept leaves the lifecycle on `WAIT_SHIP` or `SHIPPED` until a later pull says otherwise.

A pull that reports `CANCELLED` after the stored status is already past `WAIT_PAYMENT` becomes Needs review.

## When it fails

If HioBuy rejects the intercept, the error is `UPSTREAM_ERROR` and interception status is left as it was. A customer cancel that cannot be mirrored upstream stays cancelled locally and waits in Needs review. Do not delete the HioBuy shipment id to "retry create".

## Code

- `cancelShipment` in `server/data.ts`
- `noteShipmentCancelled`, intercept handler in `server/fulfillment-sync.ts`
- `cancelFulfillmentShipment`, `interceptFulfillmentShipment` in `server/services/hiobuy/fulfillment.ts`
- `interceptionDisplay` in `src/domain/status.ts`
