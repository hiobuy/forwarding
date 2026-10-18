# Shipment lifecycle

> Status: Implemented

A shipment has two status columns.

| Column | Who it describes |
| --- | --- |
| `shipments.status` | Customer progress in this app |
| `shipments.upstream_status` | HioBuy lifecycle, once `hiobuy_shipment_id` exists |

Admin lists use `adminShipmentStatus`. A linked shipment shows the HioBuy label. An unlinked shipment shows `Local · …` and appears only under All.

## HioBuy lifecycle

| Code | Admin label | Customer label when linked |
| --- | --- | --- |
| `PENDING` | Processing | Processing |
| `WAIT_PAYMENT` | Awaiting Payment | To Pay, or Payment Received if the customer already paid |
| `WAIT_SHIP` | Ready to Ship | Ready to Ship |
| `SHIPPED` | Shipped | In Transit |
| `SIGNED` | Delivered | Completed |
| `CANCELLED` | Cancelled | Cancelled |

`WAIT_PAYMENT` is not "the customer has not paid". `WAIT_SHIP` is the fulfillment ready-to-ship state.

`SIGNED` is the shipment value for delivery. The package value for the same event is `DELIVERED`. `mapHiobuyShipmentStatus` maps `SIGNED` to local `DELIVERED`. It does not write `SIGNED` into `packages.package_status`.

`SIGNED` and `CANCELLED` are terminal. A pull that would move backwards becomes Needs review and keeps the stored upstream status.

## Customer-only values

These exist before, or without, a HioBuy id:

| Code | Label |
| --- | --- |
| `CONSOLIDATING` | Consolidating |
| `WAITING_FOR_WEIGHT` | Waiting for Final Weight |
| `TO_PAY` | To Pay |
| `READY_TO_SHIP` | Ready to Ship |
| `SHIPPED` | Shipped |
| `IN_TRANSIT` | In Transit |
| `DELIVERED` | Delivered |
| `CANCELLED` | Cancelled |

After HioBuy Pay, local status stays `READY_TO_SHIP` while upstream is `WAIT_SHIP`. After dispatch, local status becomes `IN_TRANSIT` while upstream is `SHIPPED`.

## Payment status

Stored on `shipments.hiobuy_payment_status`. It is not the lifecycle.

| Code | Admin label |
| --- | --- |
| `UNPAID` | HioBuy unpaid |
| `PARTIAL` | HioBuy partial |
| `PAID` | HioBuy paid |

Customer money is a different sentence: Customer due, Customer paid, or Customer not billed (`customerPaymentLabel`).

## Code

- `src/domain/status.ts` (`HIOBUY_SHIPMENT_LIFECYCLE`, `adminShipmentStatus`, `customerShipmentDisplay`)
- `decideShipmentPull`, `applyShipmentRemote` in `server/fulfillment-sync.ts`
