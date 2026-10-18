# Quote unavailable

> Status: Implemented

A quote is unavailable when HioBuy is not connected, the country is closed, the upstream quote fails, or a stored consolidation quote no longer matches. No wallet moves in any of these cases.

## Errors this app returns

| Code | When |
| --- | --- |
| `UPSTREAM_ERROR` | HioBuy is not connected, the key was rejected, or the quote HTTP call failed. The calculator message is "HioBuy isn't connected, so shipping estimates aren't available." or the upstream message |
| `DESTINATION_CLOSED` | `freight_areas.enabled` is false for that country |
| `VALIDATION_ERROR` | Missing channel, bad country code, or dimensions that are only partly filled |
| `NOT_FOUND` | Channel detail was not returned for that destination |
| `QUOTE_NOT_FOUND` | Consolidation quote id is not this customer's |
| `QUOTE_EXPIRED` | `shipping_quotes.expires_at` has passed |
| `QUOTE_MISMATCH` | The packages or the address changed after the quote |
| `ROUTE_UNAVAILABLE` | The fresh quote no longer contains that channel |

`INVALID_API_KEY` on the quote client becomes `UPSTREAM_ERROR` with "HioBuy rejected the API key, so quotes are unavailable." HTTP 403 `FULFILLMENT_MODE_NOT_SUPPORTED` or `WAREHOUSE_AUTH_INVALID` is the same wrapper. Fix the connection, then quote again. See [INVALID_API_KEY](invalid-api-key.md) and [Warehouse authorization](warehouse-authorization.md).

There is no local error code named `QUOTE_UNAVAILABLE`. Do not invent one in the client. Surface the code above.

## What to check

1. Settings → Integration shows a successful warehouse and channel sync.
2. Settings → Destinations has the country enabled. A newly synced country is inserted with `enabled: true`. A country that already has a switch keeps that switch.
3. The cargo attribute is one of `GENERAL`, `BATTERY`, `MAGNETIC`, `LIQUID`, `POWDER`, `SENSITIVE`.
4. For a consolidation, search routes again instead of replaying an expired quote id.
5. The public and customer payloads omit cost. An empty route list with `upstreamMessage` means HioBuy returned no sellable channel, not a hidden local rate.

## Code

- `server/calculator.ts`
- `server/services/hiobuy/quotes.ts`
- `createShipment` quote checks in `server/data.ts`
- `src/domain/live-quote.ts`
