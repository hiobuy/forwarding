# Data model

> Status: Implemented

Schema: `server/db/schema/app.ts`. Migrations: `drizzle/`, starting from a single `0000_baseline.sql`. Customer money columns that end in `Fen` are USD cents. HioBuy cost columns are CNY fen. Weight is grams. Dimensions are millimeters.

## Commercial records

| Table | Role |
| --- | --- |
| `wallets`, `wallet_transactions` | USD customer balance |
| `payments`, `bank_transfers`, `payment_events`, `refund_records` | How the customer paid, and refunds |
| `checkouts`, `checkout_items`, `charges` | The bill for a shipment |
| `shipment_earnings`, `shipment_earning_adjustments` | Cost, markup, rate, and margin frozen at pack time |
| `freight_policy` | API key, markup, exchange rate, webhook secret |
| `freight_areas` | Destination countries and regions from the channel sync, each on or off. Quotes still ask HioBuy |
| `warehouse_locations` | Synced warehouse address |
| `idempotency_keys` | Replay of create, pay, and top-up |

## Fulfillment records

| Table | Role |
| --- | --- |
| `packages` | Local parcel plus `hiobuy_package_id`, `hiobuy_inbound_notice_id`, lifecycle, and `condition_status` |
| `shipments` | Local progress, `upstream_status`, `hiobuy_shipment_id`, `hiobuy_payment_status`, `interception_status` |
| `shipment_packages`, `shipment_addresses`, `shipment_methods` | What was consolidated, where it goes, which channel |
| `package_photos` | R2 object or a HioBuy `remote_url` |
| `package_exceptions`, `vas_requests` | Local exception and service rows |
| `unclaimed_parcels`, `claims` | Local claim flow. Not the HioBuy unclaimed API |
| `fulfillment_sync_tasks` | One job per entity and action. This status is not the business status |
| `fulfillment_sync_attempts` | One HTTP attempt, redacted |
| `fulfillment_remote_links` | Local id to remote id |
| `fulfillment_webhook_events` | Accepted webhook ids with their outcome. A repeat is ignored. Kept 30 days |

`packages.package_status` stores the HioBuy package lifecycle. `shipments.status` stores the customer flow. `shipments.upstream_status` stores the HioBuy shipment lifecycle. Keep those columns separate.

## Operator settings

Behavior is in [Advanced settings](../customization/advanced-settings.md).

| Table | Role |
| --- | --- |
| `platform_settings` | Google, Turnstile, customer AI, and HioBuy Pay 2FA. One row, id `default` |
| `number_sequences` | Next member, package, and shipment display number |
| `email_change_requests`, `email_change_codes` | Pending address change. Token and code are hashes |
| `pay_grants` | One authenticator grant for one HioBuy pay |
| `turnstile_tokens` | Used widget tokens |

`user.member_code` and `packages.public_id` / `shipments.public_id` are display numbers. Relations use the primary key and `hiobuy_*` ids.

## Code

- `server/db/schema/app.ts`
- Display labels: `src/domain/status.ts`
