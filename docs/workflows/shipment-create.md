# Shipment creation

> Status: Implemented

## Purpose

Turn received packages, a destination address, and a channel into a local shipment, then ask HioBuy to create the warehouse shipment.

## Before you start

- Every selected package is eligible: `RECEIVED`, `NORMAL`, unlocked, no open exception, no unfinished local service.
- The destination country is enabled.
- A quote id matches the same packages and address, and it has not expired.
- HioBuy is connected. If it is not, the local shipment can still be created and `shipment_create` is not queued (`local_only`).

## Steps

1. The customer requests routes with `POST /api/shipping/quotes`. The server stores `shipping_quotes`.
2. Submit consolidation with `POST /api/shipments`. The browser price is ignored. `quoteForPackages` runs again.
3. The server inserts the shipment as `CONSOLIDATING`, copies the address, stores the channel, and sets an estimated freight charge to `ESTIMATED`.
4. Selected packages become `CONSOLIDATED` and `LOCKED`.
5. `enqueueShipmentCreate` adds `shipment_create` when `shipmentCreateReady` passes.
6. The worker calls `POST /v1/fulfillment/shipments/create` and saves `hiobuy_shipment_id`. Upstream status starts as `PENDING`.

`shipmentCreateReady` requires a channel code, a complete address, a remote package id on every package, and remote package status `RECEIVED`. Otherwise the task waits and records the reason.

## HioBuy API

`POST /v1/fulfillment/shipments/create` with `Idempotency-Key`.

Official reference: [Shipments](https://hiobuy.com/en/api-docs/fulfillment-shipments).

External reference: `shp_` plus the internal shipment id.

## Local data

- `shipments`, `shipment_packages`, `shipment_addresses`, `shipment_methods`, `charges`
- `packages.lock_status=LOCKED`, `package_status=CONSOLIDATED`
- `fulfillment_sync_tasks.action=shipment_create`

Status sync never creates a remote shipment. Creation only follows this consolidation path.

## HioBuy status

A created shipment is `PENDING` (admin label Processing). It is not `WAIT_PAYMENT` until the warehouse finishes packing and returns a payable amount.

## When it fails

| Upstream code | Local result |
| --- | --- |
| `PACKAGE_ALREADY_CONSOLIDATED`, `PARCEL_NOT_FOUND`, `SHIPMENT_CREATE_EXCEPTION` | Needs review |
| Timeout | Retry. No remote id is invented |
| 409 with `existing_resource` | Adopt when the external reference matches. Otherwise review |
| Package not linked or not received | Task stays `waiting`. The local consolidation remains |

Customer cancel before a remote id exists marks the create task `skipped`. See [Cancellation and interception](cancel-intercept.md).

## Code

- `createShipment` in `server/data.ts`
- `enqueueShipmentCreate`, `shipmentCreateReady` callers in `server/fulfillment-sync.ts`
- `shipmentCreateReady`, `interpretShipmentCreate` in `src/domain/fulfillment-sync.ts`
- `createFulfillmentShipment` in `server/services/hiobuy/fulfillment.ts`
