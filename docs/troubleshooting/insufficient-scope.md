# INSUFFICIENT_SCOPE

> Status: Partially Implemented

Official definition: HTTP 403, category `AUTH_ERROR`. The API key is missing the scope required for that route. Source: [HioBuy errors](https://hiobuy.com/en/api-docs/errors).

This repository does not special-case the string `INSUFFICIENT_SCOPE`. A 403 still pauses fulfillment sync, because every HTTP 403 is classified as `pause` in `src/domain/fulfillment-sync.ts`. Settings does not show a dedicated sentence for it. The operator sees `UPSTREAM_ERROR` and the upstream message.

## What it usually means here

The key is accepted as a key, but the app cannot call `/v1/fulfillment/*`. That is a different code when the app is in self-fulfillment mode: `FULFILLMENT_MODE_NOT_SUPPORTED`. Scope failures also show up when the portal app was not granted the fulfillment routes you are calling.

`INSUFFICIENT_SCOPE` on product search is a portal channel issue. This forwarding app does not call product search.

## What to check

1. Developer Portal → the app is warehouse fulfillment, not self-fulfillment.
2. The key belongs to that app and that environment. A sandbox key will not gain fulfillment scope for WH-DEV.
3. Retry after the portal change. A paused task does not resume by itself. Test the connection in Settings → Integration, which calls locations and channels.
4. Keep the HioBuy `request_id`. This app stores it as `upstream_request_id` when the sync attempt has one.

Related codes that are also 403 and are not rewritten into `INSUFFICIENT_SCOPE`: `FORBIDDEN`, `FULFILLMENT_ACCESS_REQUIRED`, `FULFILLMENT_ACCESS_SUSPENDED`. The last two are marked reserved in the official error list.

## Code

- `src/domain/fulfillment-sync.ts` (`httpStatus === 403`)
- `server/freight.ts`
- `server/services/hiobuy/quotes.ts`
- `server/services/hiobuy/wallet.ts`
