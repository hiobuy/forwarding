# Warehouse receiving

> Status: Implemented

## Purpose

Copy the warehouse's received state onto the local package after HioBuy has actually checked the parcel in. This is a different step from the inbound notice.

## Before you start

- The package has `hiobuy_package_id` or a notice id that a later detail call can resolve.
- Someone runs Sync from HioBuy, or HioBuy sends `package.received`.

Receiving is not something an operator types into a weight form and calls done. Photos and measurements come from the package detail payload.

## Steps

1. Pull `GET /v1/fulfillment/packages` or `GET /v1/fulfillment/packages/{id}`.
2. `decidePackagePull` compares the remote lifecycle with the local row.
3. When the remote status is `RECEIVED`, the local `package_status` becomes `RECEIVED`, and weight, dimensions, condition, and `received_at` are copied.
4. Opening a received package detail also stores `warehouse_files`, service result files, and exception files onto `package_photos.remote_url`. List payloads do not include those files.
5. The `package.received` webhook loads the same detail before it writes, so a bare event does not invent measurements.

## HioBuy API

- `GET /v1/fulfillment/packages`
- `GET /v1/fulfillment/packages/{package_id}`
- Webhook type `package.received`

Official reference: [Packages](https://hiobuy.com/en/api-docs/fulfillment-packages).

## Local data

- `packages.package_status`, `condition_status`, `weight_grams`, dimensions, `received_at`, `hiobuy_status`, `hiobuy_synced_at`
- `package_photos` when the detail includes files
- A customer notification `PACKAGE_RECEIVED` when the previous status was `PENDING`

Omitted remote dimensions do not clear local values. A failed HTTP call does not change them either.

## HioBuy status

`RECEIVED` is the warehouse lifecycle value. `condition.status` is separate: `NORMAL` or `EXCEPTION`. An exception does not replace the lifecycle.

Only a `RECEIVED` package with `NORMAL` condition, no open exception, no in-progress service, and an available lock can be added to a shipment (`packageEligibility` in `src/domain/status.ts`).

## When it fails

- No linked id: the row is not queried. Local `PKG-` is not used as a remote id.
- `404`: Needs review or missing. Local status is kept.
- Remote status would move a delivered or cancelled package backwards: Needs review.
- Consolidated locally while the shipment has not left the warehouse: a remote `SHIPPED` is stored as `CONSOLIDATED` until the shipment itself is shipped. See [Package status sync](package-sync.md).

## Code

- `pullPackageStatuses` in `server/fulfillment-sync.ts`
- `decidePackagePull`, `readPackageMedia` in `src/domain/fulfillment-sync.ts`
- Admin list and detail: `src/features/admin/AdminPackages.tsx`, `AdminPackageDetail.tsx`
