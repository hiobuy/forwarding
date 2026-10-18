# Shipping quote and markup

> Status: Implemented

## Purpose

Show a USD selling price from HioBuy's CNY quote plus the reseller's markup and exchange rate, without creating a shipment or debiting either wallet.

## Before you start

- HioBuy is connected. Otherwise the calculator returns `UPSTREAM_ERROR` and says estimates are not available.
- The destination country is enabled in `freight_areas`. A closed country returns `DESTINATION_CLOSED`.
- Settings → Pricing has a markup percent, an optional fixed CNY amount, and a CNY-per-USD rate.

## Steps

1. Public `POST /api/shipping/calculator`, customer `POST /api/shipping/quotes`, or admin `POST /api/admin/calculator` collects weight, dimensions, cargo attributes, and destination.
2. The server calls `POST /v1/fulfillment/shipping/quotes`.
3. `src/domain/freight.ts` converts CNY fen to USD cents with the current policy.
4. Customer and public responses drop cost, markup, and margin. The admin calculator adds CNY cost and estimated margin.
5. A consolidation quote is stored in `shipping_quotes` with an expiry. Creating a shipment requires that id and then recalculates.

The assistant's freight estimate goes through the same `server/calculator.ts` path.

## HioBuy API

- `POST /v1/fulfillment/shipping/quotes`
- `GET /v1/fulfillment/shipping/channels`
- `GET /v1/fulfillment/shipping/channels/{code}`
- `GET /v1/fulfillment/shipments/item-attributes`

Cargo attributes this app sends: `GENERAL`, `BATTERY`, `MAGNETIC`, `LIQUID`, `POWDER`, `SENSITIVE`.

## Local data

A pure calculator call does not insert a shipment. A consolidation quote inserts `shipping_quotes`. No wallet row changes. `shipment_earnings` is written later, when freight is billed, not at estimate time.

## HioBuy status

A quote does not change package or shipment status.

## When it fails

| Code | Cause |
| --- | --- |
| `UPSTREAM_ERROR` | Not connected, or HioBuy rejected the quote request |
| `DESTINATION_CLOSED` | Country switch is off |
| `QUOTE_NOT_FOUND` | Consolidation quote id is unknown |
| `QUOTE_EXPIRED` | Quote TTL passed |
| `QUOTE_MISMATCH` | Packages or address changed |
| `ROUTE_UNAVAILABLE` | The channel is no longer returned for those packages |
| `INVALID_API_KEY` | Key rejected. Quotes stop |

See [Quote unavailable](../troubleshooting/quote-unavailable.md).

## Code

- `server/calculator.ts`
- `server/services/hiobuy/quotes.ts`
- `src/domain/freight.ts`, `src/domain/live-quote.ts`
- UI: `src/features/calculator/`
- Policy editor: Settings → Pricing in `src/features/admin/AdminSettings.tsx`
