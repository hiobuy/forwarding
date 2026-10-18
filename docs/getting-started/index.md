# Project

> Status: Implemented

HioBuy Forwarding is the reseller's own membership, package, shipment, USD price, and customer wallet. Warehouse receiving, packing, outbound, and cross-border transport stay with the [HioBuy Fulfillment API](https://hiobuy.com/en/api-docs/fulfillment).

This guide explains how this repository uses those APIs to run a forwarding business. It is not a copy of the HioBuy API reference. Field names and error codes follow the official docs. Local behavior follows this repository.

## What the app does today

Customers can register, view a synced China warehouse address, pre-alert domestic parcels, cancel a pre-alert that is still `PENDING`, claim a local unclaimed parcel, resolve an exception, consolidate, pay final freight in USD, track shipments, and estimate a selling price. Customers cannot request value-added services yet, because the HioBuy warehouse does not offer them.

Operators use `/admin` to connect HioBuy, open destination countries, set one markup and exchange rate, inspect packages and shipments, pull status, receive HioBuy webhooks, pay HioBuy after the customer has paid, read the fulfillment wallet, issue invoices, manage staff roles, and configure email and customer collection.

## Six rules

1. A successful inbound notice means HioBuy accepted the notice. The package stays `PENDING`. It does not mean the warehouse has received the parcel.
2. A successful customer payment debits this app's USD wallet or Stripe. It does not pay the HioBuy fulfillment wallet.
3. HioBuy `WAIT_PAYMENT` means the warehouse is waiting for fulfillment freight. The customer may already have paid in USD.
4. HioBuy `WAIT_SHIP` is the fulfillment state that means ready to ship.
5. A delivered package is `DELIVERED`. A delivered shipment is `SIGNED`. Do not swap those values.
6. Sync status (`Pending`, `Syncing`, `Synced`, `Failed`, `Needs review`) is not a package or shipment lifecycle state.

## Status words

Each page starts with one of these marks:

| Mark | Meaning |
| --- | --- |
| Implemented | The current code does this, and there is an entry point |
| Partially Implemented | Part of it exists locally. The upstream call or the automation does not |
| Planned | The official API or an early requirement mentions it. This repository has no client for it |

## Continue

- [Deploy and environment](deploy.md)
- [HioBuy Developer Account](developer-account.md)
- [API key and warehouse authorization](api-key.md)
- [WH-DEV test environment](wh-dev.md)
- [Production checklist](production.md)

Money, markup, and the two ledgers are summarized in [System architecture](../architecture/system.md).
