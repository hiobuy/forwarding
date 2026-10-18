# API client

> Status: Implemented

Every HioBuy request is built in `server/services/hiobuy/fulfillment.ts` (fulfillment mutations and reads), plus `locations.ts`, `channels.ts`, `quotes.ts`, and `wallet.ts`. `server/services/hiobuy/client.ts` is an unused stub. Do not add a second HTTP client.

The live host is `https://api.hiobuy.com`. A missing token is reported as `INVALID_API_KEY` without a network call. A network failure is `timedOut: true` and does not clear local status.

## Calls this app makes

| Use | Method and path | Module |
| --- | --- | --- |
| Probe the key, sync the warehouse | `GET /v1/fulfillment/locations` | `locations.ts` |
| Sync destination countries | `GET /v1/fulfillment/shipping/channels` | `channels.ts` |
| Channel detail | `GET /v1/fulfillment/shipping/channels/{code}` | `channels.ts` |
| Freight quote | `POST /v1/fulfillment/shipping/quotes` | `quotes.ts` |
| Cargo types | `GET /v1/fulfillment/shipments/item-attributes` | `quotes.ts` |
| Fulfillment balance | `GET /v1/fulfillment/balance` | `wallet.ts` |
| Fulfillment ledger | `GET /v1/fulfillment/transactions` and `.../{id}` | `wallet.ts` |
| Inbound notice | `POST /v1/fulfillment/inbounds/create` | `fulfillment.ts` |
| Package list and detail | `GET /v1/fulfillment/packages` and `.../{id}` | `fulfillment.ts` |
| Create, pay, cancel, intercept | `POST /v1/fulfillment/shipments/create`, `.../{id}/pay`, `.../cancel`, `.../intercept` | `fulfillment.ts` |
| Shipment list, detail, tracking | `GET /v1/fulfillment/shipments`, `.../{id}`, `.../{id}/tracking` | `fulfillment.ts` |

Create, pay, and inbound notice send `Idempotency-Key`. Reuse a key only for the same logical operation.

Money on fulfillment responses is CNY fen (`monetary_unit: "CNY_minor"` on the official routes). This app converts to USD cents only in `src/domain/freight.ts`.

## Adding a call

1. Confirm the path and fields in the official doc.
2. Add a function next to the ones above.
3. Call it from `server/admin.ts` or `server/index.ts`.
4. Map the error in `src/domain/fulfillment-sync.ts` if it changes sync behavior.
5. Do not return cost, markup, or margin to a customer or visitor.

## Code

- `server/services/hiobuy/upstream.ts` reads `error.code` without changing the request
- `server/services/hiobuy/fulfillment.ts`
