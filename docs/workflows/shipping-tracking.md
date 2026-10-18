# Shipping and tracking

> Status: Implemented

## Purpose

Show that the warehouse has dispatched the shipment, store the tracking number, and label scan events for customers.

## Before you start

- The shipment has `hiobuy_shipment_id`.
- HioBuy Pay has moved it to `WAIT_SHIP`, or the warehouse dispatches from that state.
- Customer USD payment is already recorded. A dispatch that arrives before local payment is allowed becomes Needs review.

## Steps

1. Pull shipment detail, or receive webhook `shipment.dispatched`.
2. `applyShipmentRemote` sets `upstream_status=SHIPPED` and local status `IN_TRANSIT` when the customer has paid.
3. The tracking number on the payload is copied. An empty remote tracking number does not clear the local one.
4. Linked packages in `RECEIVED` or `CONSOLIDATED` become package `SHIPPED`.
5. On shipment open, `readFulfillmentShipmentTracking` loads `GET /v1/fulfillment/shipments/{id}/tracking`. Labels come from Settings → Tracking (`src/domain/tracking-events.ts`).
6. Webhook `shipment.delivered` or a pull of `SIGNED` sets local status `DELIVERED` and package status `DELIVERED`.

Packing files (`PACKING_IMAGE`, `PACKING_VIDEO`) and `boxes` are stored when a shipment at `WAIT_PAYMENT` or later is opened. List payloads do not include them. Videos are the files whose type contains `VIDEO`.

## HioBuy API

- `GET /v1/fulfillment/shipments/{id}`
- `GET /v1/fulfillment/shipments/{id}/tracking`
- Webhooks `shipment.dispatched` and `shipment.delivered`

## Local data

- `shipments.upstream_status`, `status`, `tracking_number`, `hiobuy_synced_at`
- `packages.package_status` for the linked rows
- `package_photos` and carton rows from `boxes`
- Customer notifications `SHIPPED` and `DELIVERED`

## HioBuy status

| HioBuy shipment | Local customer status | Package |
| --- | --- | --- |
| `WAIT_SHIP` | `READY_TO_SHIP` if the customer paid | `CONSOLIDATED` |
| `SHIPPED` | `IN_TRANSIT` | `SHIPPED` |
| `SIGNED` | `DELIVERED` | `DELIVERED` |

Package `DELIVERED` and shipment `SIGNED` are different codes for the same physical delivery. Do not write `SIGNED` into `packages.package_status`.

## When it fails

`dispatchDecision` returns review when HioBuy says shipped before local payment allows it. Upstream status is still stored as `SHIPPED`, and a `shipment_refresh` task explains the conflict. The customer wallet is not changed.

A failed tracking read keeps the previous tracking number.

## Code

- `applyShipmentRemote`, `applyDispatched`, `applyDelivered` in `server/fulfillment-sync.ts`
- `readFulfillmentShipmentTracking` in `server/services/hiobuy/fulfillment.ts`
- `src/domain/tracking-events.ts`
- Customer tracking page: `src/features/tracking/TrackingPage.tsx`
- Timeline: `src/domain/timeline.ts`, `src/components/timeline.tsx`, `src/components/carrier-tracking.tsx`
