# Package status sync

> Status: Implemented

## Purpose

Keep local package lifecycle, condition, weight, and size aligned with HioBuy after the package is linked. Sync status on the task row stays independent.

## Before you start

The package has `hiobuy_package_id`. Unlinked rows cannot be selected for a status pull.

## Steps

1. Admin → Packages → Sync from HioBuy pulls every linked package by paging `GET /v1/fulfillment/packages`.
2. Sync selected, or Sync now on the detail, calls `GET /v1/fulfillment/packages/{id}` with a concurrency cap.
3. Each row is classified: checked, updated, unchanged, failed, or needs review.
4. The attempt log is readable at `GET /api/admin/packages/:id/sync`.

Customer consolidation also writes `CONSOLIDATED` locally before HioBuy has packed the shipment. Cancelling that consolidation returns still-consolidated packages to `RECEIVED` and unlocks them.

## HioBuy API

`GET /v1/fulfillment/packages` and `GET /v1/fulfillment/packages/{package_id}`.

Task `action`: `status_pull`.

## Local data

Updated only after `decidePackagePull` returns `updated`:

- `package_status` and `hiobuy_status`
- `condition_status`
- weight and dimensions when the payload includes them
- `hiobuy_synced_at`

`vas_status`, `lock_status`, and `disposition` are not overwritten by the lifecycle pull. They stay on their own columns.

## HioBuy status

Lifecycle values: `PENDING`, `RECEIVED`, `CONSOLIDATED`, `SHIPPED`, `DELIVERED`, plus `TRANSFERRING`, `DISCARDED`, `UNCLAIMED`, `ARCHIVED`.

While the local shipment is still `CONSOLIDATING`, `WAITING_FOR_WEIGHT`, `TO_PAY`, or `READY_TO_SHIP`, a remote package snapshot of `SHIPPED` is applied as `CONSOLIDATED`. `SHIPPED` on the package waits until the shipment has actually left. `DELIVERED` on the package follows shipment `SIGNED`.

## When it fails

Timeouts and HTTP errors leave the previous weight, size, and status in place. An unrecognized status, an id mismatch, or a backwards move becomes Needs review. A second pull that lands while the row is updating also becomes Needs review.

## Code

- `pullPackageStatuses`, `applyShipmentRemote` package updates in `server/fulfillment-sync.ts`
- `decidePackagePull` in `src/domain/fulfillment-sync.ts`
- Labels and filters: `src/domain/status.ts`
