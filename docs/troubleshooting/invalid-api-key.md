# INVALID_API_KEY

> Status: Implemented

Official definition: HTTP 401, category `AUTH_ERROR`. The Bearer token is missing or invalid. `UNAUTHORIZED` is an alias of the same failure. Source: [HioBuy errors](https://hiobuy.com/en/api-docs/errors).

## How this app sees it

- `callHiobuy` returns this code locally when the token string is empty, before any network call.
- `upstreamFailure` treats HTTP 401 or body code `INVALID_API_KEY` as a failed call.
- Settings maps it to: "This API key was rejected. Check it in the Developer Portal, or generate a new Production key."
- Sync classifies it as `pause`. Later fulfillment jobs do not keep retrying a rejected key.
- Quotes and the fulfillment wallet turn it into `UPSTREAM_ERROR` with a message that the key was rejected, so estimates and the wallet read stop.

A timeout is `UPSTREAM_TIMEOUT`, not an invalid key. The saved key stays.

## What to check

1. The portal key is `hio_live_*` for WH-DEV or production. `hio_test_*` is the wrong key for WH-DEV.
2. Settings → Integration is the key that is actually used when one is saved. `HIOBUY_API_TOKEN` is only the fallback.
3. The value was not truncated. The server rejects a trimmed key shorter than 8 characters as `VALIDATION_ERROR` before it calls HioBuy.
4. Read `upstream_request_id` on the sync attempt. Do not paste the key into logs. `redactSensitive` removes bearer tokens from stored messages.

## Code

- `server/services/hiobuy/fulfillment.ts`
- `server/services/hiobuy/upstream.ts`
- `explainConnectionError` in `server/freight.ts`
- `classifyConflict` in `src/domain/fulfillment-sync.ts`
