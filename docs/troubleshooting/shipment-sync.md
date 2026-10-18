# Shipment sync failed

> Status: Implemented

Shipment tasks are `shipment_create`, `shipment_status_pull`, `shipment_pay`, `shipment_cancel`, and `shipment_intercept`. A failed attempt keeps the previous `upstream_status`, payment status, interception status, and tracking number.

## Create stays waiting

`shipmentCreateReady` refuses to call HioBuy until every package has a remote id and remote status `RECEIVED`, the channel code is set, and the address has name, phone, country, city, postal code, and line 1. The task reason is the sentence to fix. The local consolidation is still there.

Create responses with `PACKAGE_ALREADY_CONSOLIDATED`, `PARCEL_NOT_FOUND`, or `SHIPMENT_CREATE_EXCEPTION` go to Needs review. A 2xx without an id is `MISSING_REMOTE_ID`.

## Pull failures

| Symptom | Cause in code |
| --- | --- |
| Not queried | No `hiobuy_shipment_id`. The display number is not used |
| `SHIPMENT_NOT_FOUND` or HTTP 404 | Linked id is missing upstream. Local status kept |
| `STATUS_CONFLICT` | Id mismatch, external ref mismatch, unknown status, or a backwards move from `SIGNED` or `CANCELLED` |
| `CONCURRENT_SYNC` | Another write landed during the update. Local status kept |
| `NOT_IN_LIST` | A full pull did not include this linked id |
| Rate limit | Remaining selected pulls in that batch stop. Local status kept |

Status pull does not create a shipment and does not pay one.

## Pay and cancel

Pay errors are in [Insufficient HioBuy wallet balance](wallet-balance.md) and [Payment state mismatch](payment-mismatch.md).

Cancel after HioBuy has moved past `WAIT_PAYMENT` is Needs review, not a second cancel call. Intercept rejection does not change `upstream_status`.

## Code

- `server/fulfillment-sync.ts`
- `decideShipmentPull`, `interpretShipmentCreate` in `src/domain/fulfillment-sync.ts`
- Log UI: `src/features/admin/AdminShipmentDetail.tsx`
