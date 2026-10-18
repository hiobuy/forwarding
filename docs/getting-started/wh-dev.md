# WH-DEV test environment

> Status: Implemented

WH-DEV is the test warehouse configuration HioBuy assigns to an app. Test it with a Production key (`hio_live_*`) plus that code. It is not the Sandbox, and it is not live outbound.

Official steps: [WH-DEV testing guide](https://hiobuy.com/en/api-docs/fulfillment-wh-dev-testing). The list below is only what this repository can run.

## Before you start

- The portal app has warehouse fulfillment turned on, and the WH-DEV code is bound. See [HioBuy Developer Account](developer-account.md).
- The fulfillment wallet has a test balance. This app cannot top up the HioBuy wallet.
- `.dev.vars` contains `ADMIN_EMAILS`. Keep `ENVIRONMENT` off `production` if you want the development mailbox.
- The destination country is enabled under Settings → Destinations. A closed country cannot be quoted or shipped.

Do not paste `hio_test_*` into Integration. Sandbox fixtures do not match the WH-DEV warehouse. See [Sandbox](https://hiobuy.com/en/api-docs/sandbox).

## Walkthrough in this app

1. Settings → Integration. Save `hio_live_*`. Confirm the warehouse address and the channels both sync.
2. Pre-alert a domestic parcel as a customer. The limit is 30 rows. The route is `POST /api/packages/prealert`.
3. When automatic notices are on, that creates an `inbound_create` task. You can also submit from Admin → Packages: `POST /api/admin/packages/sync`.
4. After a successful notice the package is still `PENDING`. Use Sync from HioBuy until HioBuy reports `RECEIVED`.
5. Quote and submit a consolidation for received packages. The server recalculates the selling price. It does not trust a price from the browser.
6. Consolidation queues `shipment_create`. Every package needs a `hiobuy_package_id`, and the remote status must be received. Otherwise the task stays waiting.
7. After the warehouse packs and returns a payable amount, the upstream shipment status becomes `WAIT_PAYMENT` and the local customer bill becomes due.
8. The customer pays from the USD wallet or Stripe. That closes the customer bill only.
9. An admin confirms HioBuy Pay on the shipment. The remote status must be `WAIT_PAYMENT`, the customer must already have paid, and the fulfillment wallet must cover the CNY cost.
10. Sync the shipment again. `WAIT_SHIP` means ready to ship. After dispatch the status is `SHIPPED`. Delivery is `SIGNED`. Scan events come from `GET /v1/fulfillment/shipments/{id}/tracking`.

Procurement order create (`POST /v1/orders/create` in the official step 2a) has no client here. WH-DEV in this app starts from an inbound notice.

## Where failures show up

Each task and attempt is on the package or shipment detail. The tables are `fulfillment_sync_tasks` and `fulfillment_sync_attempts`. Secrets are redacted before they are stored.

See [Inbound notice sync failed](../troubleshooting/inbound-sync.md), [Shipment sync failed](../troubleshooting/shipment-sync.md), and [Insufficient HioBuy wallet balance](../troubleshooting/wallet-balance.md).
