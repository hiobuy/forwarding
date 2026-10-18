# Package pre-alert and inbound notice

> Status: Implemented

## Purpose

Tell HioBuy that a domestic parcel is on its way, and keep a local package row the customer can see before the warehouse receives it.

## Before you start

- HioBuy is connected and not paused.
- The parcel has a domestic tracking number. Tracking numbers are unique in `packages`.
- Automatic notices follow Settings. `enqueueInboundNotices` no-ops when auto sync is off or the connection is paused. An admin can still submit selected packages.

## Steps

1. The customer posts up to 30 rows to `POST /api/packages/prealert`.
2. The server inserts `packages` as `PENDING` / `NORMAL` and then calls `enqueueInboundNotices`.
3. A worker runs `inbound_create`: `POST /v1/fulfillment/inbounds/create` with an `Idempotency-Key`.
4. On success the task stores the remote id. The package status stays `PENDING`.
5. Admin → Packages can submit the same action with `POST /api/admin/packages/sync`.

A package that already has a remote id is not created again.

## HioBuy API

`POST /v1/fulfillment/inbounds/create`

`DELETE /v1/fulfillment/inbounds/{id}`

Official reference: [Inbound notice](https://hiobuy.com/en/api-docs/fulfillment-inbounds).

The local external reference is `pkg_` plus the internal package id (`externalPackageRef`). Do not send the display number `PKG-` as the remote id.

## Local data

- Insert `packages` with `package_status=PENDING`.
- On success, save `hiobuy_inbound_notice_id` and, when the payload distinguishes it, `hiobuy_package_id`.
- Insert or update `fulfillment_sync_tasks` (`action=inbound_create`) and one `fulfillment_sync_attempts` row.
- A claimed local parcel queues `inbound_create` as `needs_review` so an operator confirms it is not already in the warehouse (`noteClaimedPackage`).

## HioBuy status

Acceptance of the notice is not `RECEIVED`. The package remains pending until a later pull or a `package.received` webhook applies a received snapshot. See [Warehouse receiving](receiving.md).

## When it fails

| Result | What stays true |
| --- | --- |
| Timeout or HTTP error | No remote id is invented. Local package remains |
| `401 INVALID_API_KEY` or `403` | The task pauses. Fix the key or warehouse mode, then retry |
| Missing remote id on a 2xx body | Needs review. The package is not marked received |
| Duplicate conflict | Adopt only when the external ref and tracking number match. Otherwise Needs review |

The success message in the admin response is: "Inbound notice submitted. The package stays Pending until HioBuy reports it received."

## Cancel and delete

A package still `PENDING` can be deleted by its customer (`DELETE /api/packages/:id`) or by staff with `packages.write` (`DELETE /api/admin/packages/:id`). Staff deletes are audited and the customer gets an in-app notice.

1. A package on a shipment, or with any status other than `PENDING`, is refused.
2. An `inbound_create` task in `syncing` is refused with "being sent to the warehouse". Otherwise the task is held as `cancelling` so the cron cannot submit it meanwhile.
3. When the package has a HioBuy id, or the task has already made an attempt, `DELETE /v1/fulfillment/inbounds/{id}` is called. The id is the HioBuy package id, or the `pkg_` external ref when no id came back.
4. `cancelled` or `404` lets the delete go ahead. `INBOUND_ALREADY_RECEIVED` refuses it. `INBOUND_NOT_EDITABLE` goes ahead only when the package detail shows `DISCARDED` or is gone. Anything else refuses it and the task goes back to its previous status.
5. The package, its attributes, photos, exceptions, service requests, sync tasks, attempts, remote links, and notifications that link to it are deleted in one batch.

## Code

- `enqueueInboundNotices`, `queueSelectedPackages` in `server/fulfillment-sync.ts`
- `interpretInboundResponse`, `splitInboundIds` in `src/domain/fulfillment-sync.ts`
- `createInboundNotice`, `cancelInboundNotice` in `server/services/hiobuy/fulfillment.ts`
- Cancel and delete: `deletePendingPackage` in `server/data.ts`, `withdrawInboundNotice` in `server/fulfillment-sync.ts`, `interpretInboundCancel` in `src/domain/fulfillment-sync.ts`
- Customer pre-alert: `server/data.ts`, `src/features/packages/PackagePages.tsx`
