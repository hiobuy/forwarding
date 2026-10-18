# Developer Guide

English documentation for deploying and extending HioBuy Forwarding. Admin → Developer Guide renders these files. The pages do not call HioBuy.

Status marks used in each page: **Implemented**, **Partially Implemented**, **Planned**.

## Getting Started

- [Project](getting-started/index.md)
- [Deploy and environment](getting-started/deploy.md)
- [HioBuy Developer Account](getting-started/developer-account.md)
- [API key and warehouse authorization](getting-started/api-key.md)
- [WH-DEV test environment](getting-started/wh-dev.md)
- [Production checklist](getting-started/production.md)
- [Demo Admin Mode](getting-started/demo-admin.md)
- [Public website deployment](getting-started/public-site.md)

## Architecture

- [System architecture](architecture/system.md)
- [Responsibilities](architecture/responsibilities.md)
- [Data model](architecture/data-model.md)
- [API client](architecture/api-client.md)
- [Sync tasks and logs](architecture/sync.md)
- [Customer wallet and HioBuy wallet](architecture/wallets.md)

## Business Workflows

- [Package pre-alert and inbound notice](workflows/inbound-notice.md)
- [Warehouse receiving](workflows/receiving.md)
- [Package status sync](workflows/package-sync.md)
- [Shipment creation](workflows/shipment-create.md)
- [Shipping quote and markup](workflows/quote.md)
- [Customer payment](workflows/customer-payment.md)
- [HioBuy Pay](workflows/hiobuy-pay.md)
- [Shipping and tracking](workflows/shipping-tracking.md)
- [Cancellation and interception](workflows/cancel-intercept.md)
- [Exceptions and refunds](workflows/exceptions-refunds.md)

## Status Reference

- [Package lifecycle](statuses/packages.md)
- [Shipment lifecycle](statuses/shipments.md)
- [Payment, interception, and sync](statuses/payment-and-sync.md)

## Customization

- [Branding and logo](customization/branding.md)
- [Shipping pricing](customization/pricing.md)
- [Payment providers](customization/payments.md)
- [Email templates](customization/email.md)
- [Advanced settings](customization/advanced-settings.md)
- [Customer portal](customization/customer-portal.md)
- [Admin UI](customization/admin-ui.md)
- [Localization](customization/localization.md)
- [Adding new features](customization/new-features.md)

## Troubleshooting

- [INVALID_API_KEY](troubleshooting/invalid-api-key.md)
- [INSUFFICIENT_SCOPE](troubleshooting/insufficient-scope.md)
- [Warehouse authorization](troubleshooting/warehouse-authorization.md)
- [Inbound notice sync failed](troubleshooting/inbound-sync.md)
- [Shipment sync failed](troubleshooting/shipment-sync.md)
- [Insufficient HioBuy wallet balance](troubleshooting/wallet-balance.md)
- [Payment state mismatch](troubleshooting/payment-mismatch.md)
- [Duplicate webhook and retry](troubleshooting/duplicate-webhook.md)
- [Quote unavailable](troubleshooting/quote-unavailable.md)
