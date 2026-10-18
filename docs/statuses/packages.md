# Package lifecycle

> Status: Implemented

`packages.package_status` stores the HioBuy package lifecycle. Labels are `LIFECYCLE_LABELS` in `src/domain/status.ts`. The page renders `label`. Do not map the codes again in a component.

## Main path

| Code | Admin label | When this app writes it |
| --- | --- | --- |
| `PENDING` | Pending | Pre-alert, and after a successful inbound notice |
| `RECEIVED` | Received | Pull or `package.received` webhook |
| `CONSOLIDATED` | Consolidated | Customer submits a consolidation. Also while the shipment is still inside the warehouse, even if a package snapshot says shipped |
| `SHIPPED` | Shipped | Shipment upstream becomes `SHIPPED` |
| `DELIVERED` | Delivered | Shipment upstream becomes `SIGNED` |

## Other lifecycle values

| Code | Admin label | Notes |
| --- | --- | --- |
| `TRANSFERRING` | Transferring | Shown under More. Applied only when HioBuy sends it |
| `DISCARDED` | Discarded | Same. This app does not call a discard endpoint |
| `UNCLAIMED` | Unclaimed | HioBuy lifecycle value. Local unclaimed parcels are a different table |
| `ARCHIVED` | Archived | Shown under More |

Admin filters: All, Pending, Received, Consolidated, Shipped, Delivered, then More for the four side values. Exception and sync are separate dropdowns, not tabs on this lifecycle.

## Condition

`condition_status` is `NORMAL` or `EXCEPTION`. It is HioBuy `condition.status`. It does not replace the lifecycle.

These columns are also not the lifecycle:

| Column | Values |
| --- | --- |
| `exception_status` | `NONE`, `ACTION_REQUIRED`, `RESOLVED` |
| `vas_status` | `NONE`, `REQUESTED`, `PROCESSING`, `COMPLETED`, `CANCELLED` |
| `lock_status` | `AVAILABLE`, `LOCKED`, `BLOCKED` |
| `disposition` | `NONE`, `RETURN_REQUESTED`, `DISPOSAL_REQUESTED` |

## Not a package status

Sync task status, customer payment, and HioBuy `payment_status` are not stored in `package_status`. See [Payment, interception, and sync](payment-and-sync.md).

## Code

- `src/domain/status.ts`
- `decidePackagePull` in `src/domain/fulfillment-sync.ts`
- Column: `packages.package_status` in `server/db/schema/app.ts`
