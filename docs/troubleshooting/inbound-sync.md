# Inbound notice sync failed

> Status: Implemented

The task `action` is `inbound_create`. Failure is on that task. The package row stays `PENDING` unless a later receive sync says otherwise.

## How to read the attempt

Open the package in Admin. The sync log is `GET /api/admin/packages/:id/sync`.

| Outcome | Meaning |
| --- | --- |
| `synced` | HioBuy accepted the notice and returned an id. The package is still not received |
| `failed` | The request failed. No id was stored from that attempt |
| `needs_review` | The body was ambiguous, or the existing remote resource did not match this tracking number |
| `skipped` | Already submitted, or not eligible to create again |
| `waiting` | Connection paused, or the row is not ready |

`explainPackageSyncIssue` turns the stored code into the sentence on the packages screen.

## Causes that match the code

- Empty token or `INVALID_API_KEY`. See [INVALID_API_KEY](invalid-api-key.md).
- `403`, including `FULFILLMENT_MODE_NOT_SUPPORTED` and `WAREHOUSE_AUTH_INVALID`. The task pauses.
- Timeout (`TIMEOUT` / `UPSTREAM_TIMEOUT`). Retry. The key is not marked invalid.
- HTTP 429. Retry with backoff. The code records `RATE_LIMITED` when the payload has that code, otherwise the HTTP status.
- 2xx without an id. Needs review, code `MISSING_REMOTE_ID`. Do not mark the package received.
- Duplicate 409. Adopt only when `external_order_id` and the tracking number match. Otherwise review. Official responses may include `error.details.existing_resource`.

A claimed parcel is queued as Needs review on purpose: "This package was claimed locally. Confirm it is not already in the HioBuy warehouse before sending a notice."

## What not to do

Do not create a second notice with a new idempotency key for the same package while the first result is unknown. `inboundIdempotencyKey` is stable per package id. If the result is unknown, read the task and the HioBuy package. Do not flip `package_status` to `RECEIVED` by hand to "finish" the sync.

## Code

- `queueSelectedPackages`, `runInbound` in `server/fulfillment-sync.ts`
- `interpretInboundResponse` in `src/domain/fulfillment-sync.ts`
