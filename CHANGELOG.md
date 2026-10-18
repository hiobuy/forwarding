# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-18

Initial public release of HioBuy Forwarding.

### Added

- Customer portal: registration with email verification, optional Google sign-in and Turnstile, synced warehouse address with member code, package pre-alerts, cancel and delete for `PENDING` packages, claims, exception responses, warehouse photos and videos, consolidation with live quotes, shipments and tracking, address book, invoice details, shipping documents, notifications, and email preferences.
- USD customer wallet with Stripe Checkout top-up, operator-confirmed bank transfer top-up, and wallet or Stripe payment of freight.
- Admin console: overview, packages, shipments, customers, payments, assistant knowledge, calculator with cost and profit, and settings for business, integration, destinations, pricing, HioBuy wallet, email, advanced, payments, invoicing, tracking, and team.
- HioBuy Fulfillment integration: warehouse and channel sync, live quotes, inbound notices and their cancellation, package and shipment pulls, shipment create, pay, cancel, and intercept, tracking, and a read-only view of the fulfillment wallet.
- Signed HioBuy webhooks for `package.received`, `package.exception`, `shipment.ready_for_payment`, `shipment.dispatched`, `shipment.delivered`, `shipment.exception`, and `balance.low`, with a delivery log in the fulfillment sync panel.
- Sync tasks and attempt logs with secret redaction, conflict detection, and Needs review handling.
- Global markup, fixed fee, and exchange rate, with per-shipment cost and profit snapshots, refunds, and adjustments.
- Staff roles (owner, manager, support) with per-route permissions and optional two-factor confirmation for HioBuy Pay.
- SMTP email over Workers TCP sockets with editable templates. The welcome email is sent after email verification.
- Invoicing with invoice profiles and PDF documents.
- Optional signed-in assistant on Workers AI with confirmation before any write.
- Public website mode (`integrated` or `app-only`) and a read-only Demo Admin (`DEMO_MODE`).
- English Developer Guide rendered at `/admin/guide`.
- Apache License 2.0.

### Security

- The admin calculator returns cost and profit only to staff with `earnings.read`.
- The production Worker no longer answers on its `workers.dev` address.

### Notes

- Database migrations were squashed into `drizzle/0000_baseline.sql`. Databases created from earlier development builds must be recreated.
- Customer value-added service requests are not available yet, because the HioBuy warehouse does not offer them.

[1.0.0]: https://github.com/hiobuy/forwarding/releases/tag/v1.0.0
