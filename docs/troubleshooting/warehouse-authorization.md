# Warehouse authorization

> Status: Implemented

Warehouse fulfillment needs a warehouse developer code bound on the app. The code is not a field in this database and it is not sent by `server/services/hiobuy`. The HioBuy gateway attaches it. Setup: [Warehouse authorization](https://hiobuy.com/en/api-docs/fulfillment-setup).

## Codes

| Code | HTTP | Official meaning | What this app does |
| --- | --- | --- | --- |
| `FULFILLMENT_MODE_NOT_SUPPORTED` | 403 | `/v1/fulfillment/*` on a self-fulfillment app | Dedicated Settings message. Sync pauses |
| `WAREHOUSE_AUTH_INVALID` | 403 | The warehouse rejected developer authentication | Dedicated Settings message: bind the code HioBuy provides. Sync pauses |
| `WAREHOUSE_AUTH_REQUIRED` | 403 | Warehouse fulfillment without a warehouse authorization | Not special-cased. 403 still pauses sync. Settings shows the upstream message |
| `WAREHOUSE_AUTH_EXPIRED` | 403 | The warehouse authorization expired | Same as required. Not special-cased |
| `FULFILLMENT_ACCESS_REQUIRED` | 403 | Reserved. Access not granted | Not special-cased |
| `FULFILLMENT_ACCESS_SUSPENDED` | 403 | Reserved. Access suspended | Not special-cased |

Official list: [Errors](https://hiobuy.com/en/api-docs/errors).

## What to check

1. Portal → Authorizations → Use HioBuy fulfillment.
2. Enter the warehouse code once. Binding is per app, not per channel.
3. This app's connection error tells you to use HioBuy Warehouse plus Self Procurement. That text is intentional in `explainConnectionError`.
4. WH-DEV uses the WH-DEV code with `hio_live_*`. A production warehouse uses a different code. Mixing them fails authorization even when the key looks valid.
5. After a portal change, run Test connection. Locations and channel destinations must both succeed.

A 403 does not clear `warehouse_locations`. The previous address remains until a successful sync replaces it. Do not hand-edit that row to "fix" an auth error.

## Code

- `server/freight.ts`
- `src/domain/fulfillment-sync.ts`
- `src/features/admin/AdminSettings.tsx`
