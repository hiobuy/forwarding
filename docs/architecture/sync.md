# Sync tasks and logs

> Status: Implemented

A sync task records whether a request to HioBuy finished. It does not replace `packages.package_status` or `shipments.status`.

## Task actions

| `action` | Direction | When |
| --- | --- | --- |
| `inbound_create` | This app → HioBuy | Pre-alert, or Admin submit notice |
| `status_pull` | HioBuy → this app | Package Sync from HioBuy, Sync selected, Sync now |
| `shipment_create` | This app → HioBuy | After the customer submits a consolidation |
| `shipment_status_pull` | HioBuy → this app | Shipment pull |
| `shipment_pay` | This app → HioBuy | Admin confirms HioBuy Pay. Not on customer checkout |
| `shipment_cancel` | This app → HioBuy | Local cancel while remote is `PENDING` or `WAIT_PAYMENT` |
| `shipment_intercept` | This app → HioBuy | Admin intercept while remote is `WAIT_SHIP` or `SHIPPED` |
| `shipment_refresh` | Local review | Amount or dispatch conflict. Nothing is charged |

Task status values include `pending`, `waiting`, `syncing`, `synced`, `failed`, `needs_review`, `skipped`, and `local_only`. `Synced` means this request returned a result. It does not mean received, paid, or shipped.

Attempts are rows in `fulfillment_sync_attempts`: local id, remote id, operation, start, finish, outcome, status before and after, error code, error message, and `upstream_request_id`. `redactSensitive` strips bearer tokens and common secret prefixes before insert.

## Pull rules that must stay

- Do not guess a remote id from `PKG-` or `SHP-`.
- A failed pull keeps weight, dimensions, tracking number, and the previous status.
- Fields the remote payload omits are not blanked locally.
- `SIGNED` and `CANCELLED` are terminal. An earlier status becomes Needs review.
- Two pulls of the same row do not overwrite each other. The second becomes Needs review (`CONCURRENT_SYNC`).
- A status pull does not rewrite `shipment_earnings` or the customer wallet.

## Webhook

> Status: Partially Implemented

`POST /api/webhooks/hiobuy` verifies `HioBuy-Signature` with the secret stored on `freight_policy`. The secret is saved from the fulfillment sync panel and is never returned to the browser.

Handled event types:

- `package.received`
- `package.exception`
- `shipment.ready_for_payment`
- `shipment.dispatched`
- `shipment.delivered`
- `shipment.exception`: puts the shipment in Needs review and sends the customer an in-app notice.
- `balance.low`: shows a warning in the fulfillment sync panel until dismissed and emails the business email.

Each stored event keeps a one-line outcome, such as the record it changed or why nothing matched. The panel lists the latest 25 deliveries under Webhook deliveries. Events older than 30 days are deleted. A request refused for a missing or bad signature is not stored as an event; only its time is kept on `freight_policy.webhook_rejected_at`, so the panel can warn about a wrong secret.

A repeated event id in `fulfillment_webhook_events` with a status other than `failed` returns 200 and does not apply again. A failed event, or one left in `processing` for over a minute, is applied again on the next delivery. Unsigned or unknown payloads return 401 or 400. The webhook is not a full replacement for Sync from HioBuy.

## Operator routes

| Action | Method and path |
| --- | --- |
| Submit inbound notices | `POST /api/admin/packages/sync` |
| Pull packages | `POST /api/admin/packages/pull` with `{ "scope": "linked" }` or `{ "scope": "selected", "ids": ["..."] }` |
| Pull shipments | `POST /api/admin/shipments/pull`, same body |
| Intercept | `POST /api/admin/shipments/:id/intercept` with `{ "reason": "CUSTOMER_REQUEST", "remark": "..." }` |
| Read the log | `GET /api/admin/packages/:id/sync` and `GET /api/admin/shipments/:id/sync` |

## Where to change

| Change | File |
| --- | --- |
| Status labels, filter keys, customer and HioBuy payment labels | `src/domain/status.ts` |
| Pure rules for notices, pulls, regressions, and conflicts | `src/domain/fulfillment-sync.ts` |
| Tests for those rules | `src/domain/fulfillment-sync.test.ts`, `src/domain/domain.test.ts` |
| HioBuy calls, database writes, and attempt logs | `server/fulfillment-sync.ts` |
| HioBuy HTTP client | `server/services/hiobuy/fulfillment.ts` |
| Admin routes | `server/admin.ts` |
| Admin lists and details | `src/features/admin/AdminPackages.tsx`, `AdminPackageDetail.tsx`, `AdminShipments.tsx`, `AdminShipmentDetail.tsx` |
| Sync panel and webhook deliveries | `src/features/admin/FulfillmentSync.tsx` |
| Tables | `server/db/schema/app.ts`, plus a new `drizzle/*.sql` migration |

Write a new rule as a pure function with a test first, then wire it into the server. Pages show the `label` the API returns. Do not map `PENDING → Processing` again inside a component. A new upstream status code goes into `src/domain/status.ts` and the matching `decide*Pull` before any page changes.

HioBuy fields follow the official [packages](https://hiobuy.com/en/api-docs/fulfillment-packages), [shipments](https://hiobuy.com/en/api-docs/fulfillment-shipments), and [inbound notices](https://hiobuy.com/en/api-docs/fulfillment-inbounds) references. Do not invent a response shape in the client.
