# Responsibilities

> Status: Implemented

The reseller owns the commercial record. HioBuy owns warehouse fulfillment.

## This app owns

- Members, sessions, and member codes (`HX` plus an increment, starting at `HX10238`)
- Address book and the address snapshot copied onto a shipment
- USD customer wallet, top-ups, shipment payments, and refunds
- Selling price, markup, exchange rate, and margin snapshots
- Which destination countries are open
- Customer-facing shipment progress (`CONSOLIDATING` through `DELIVERED`)
- Notifications and email templates

Public ids `PKG-` and `SHP-` come from `number_sequences` and are reserved one at a time. Relations use the internal primary key.

## HioBuy owns

- The physical warehouse address
- Inbound receiving, measurements, condition, and photos
- Packing, outbound cartons, and the CNY freight HioBuy will charge
- Shipment lifecycle: `PENDING`, `WAIT_PAYMENT`, `WAIT_SHIP`, `SHIPPED`, `SIGNED`, `CANCELLED`
- The CNY fulfillment wallet
- International scan events

## What neither side should assume

| Event | What it does not mean |
| --- | --- |
| Inbound notice `synced` | The parcel is on the shelf |
| Customer checkout `PAID` | HioBuy `payment_status` is `PAID` |
| HioBuy `WAIT_PAYMENT` | The customer still owes USD |
| Sync status `Synced` | The business status changed |

## Code

- Customer writes: `server/data.ts`
- Admin reads and commands: `server/admin.ts`
- Upstream calls: `server/services/hiobuy/`
