# HioBuy Developer Account

> Status: Implemented

Forwarding does not create a HioBuy developer account and does not store the portal password. An operator prepares the app and key in the HioBuy Developer Portal, then gives this app a Production API key.

Official pages:

- [Fulfillment overview](https://hiobuy.com/en/api-docs/fulfillment)
- [Warehouse authorization](https://hiobuy.com/en/api-docs/fulfillment-setup)
- [WH-DEV testing](https://hiobuy.com/en/api-docs/fulfillment-wh-dev-testing)
- [Sandbox](https://hiobuy.com/en/api-docs/sandbox)
- [Errors](https://hiobuy.com/en/api-docs/errors)

## Portal settings this app depends on

1. The app must use warehouse fulfillment, not the default self-fulfillment mode. Otherwise `/v1/fulfillment/*` returns `403 FULFILLMENT_MODE_NOT_SUPPORTED`.
2. Bind the warehouse developer code HioBuy gives you. The binding is once per app. The code is not sent on API calls. The gateway attaches it.
3. When connection fails, this app tells the operator to set Fulfillment Mode to HioBuy Warehouse and Procurement Mode to Self Procurement. That sentence is `explainConnectionError` in `server/freight.ts`.
4. Fulfillment calls use `Authorization: Bearer` against `https://api.hiobuy.com`. The browser never calls that host.

## Do not mix the keys

| Key | Purpose | This app |
| --- | --- | --- |
| `hio_test_*` | Sandbox fixtures. Unrelated to an assigned warehouse | Do not use it for WH-DEV |
| `hio_live_*` plus `WH-DEV` | Integration against the assigned test warehouse. Not live fulfillment | [WH-DEV test environment](wh-dev.md) |
| `hio_live_*` plus a production warehouse authorization | Live fulfillment | [Production checklist](production.md) |

## Official APIs this repository does not call

These paths exist in the HioBuy docs. `server/services/hiobuy/` has no function for them:

- `/v1/orders/*` procurement orders. Planned.
- `/v1/fulfillment/returns`. Planned.
- `/v1/fulfillment/value-added-services` and `/v1/fulfillment/service-requests`. Local service rows exist. No upstream request. Partially Implemented.
- `/v1/fulfillment/unclaimed-packages`. Local unclaimed rows live in `unclaimed_parcels`. Partially Implemented.

## Code

- Connection and error text: `server/freight.ts`
- The only upstream HTTP module: `server/services/hiobuy/fulfillment.ts`
