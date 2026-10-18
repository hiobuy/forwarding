# Exceptions and refunds

> Status: Partially Implemented

## Purpose

Record a package problem the customer must decide, and return USD the customer paid this app. This repository does not create a HioBuy return-to-seller shipment.

## Before you start

Package condition and the exception workflow are separate from lifecycle. A package can be `RECEIVED` and `EXCEPTION` at the same time. An open exception blocks consolidation.

Refunds apply to a `payments` row that is `paid` or `disputed`. They do not call `/v1/fulfillment/shipments/{id}/pay` in reverse, and they do not call `/v1/fulfillment/returns`.

## Steps

### Exception

1. A pull that reports condition `EXCEPTION`, or webhook `package.exception`, sets `condition_status=EXCEPTION` and `exception_status=ACTION_REQUIRED`.
2. The webhook inserts `package_exceptions` when the package had no open exception, and notifies the customer.
3. The customer resolves it on the package page. That updates the local exception row. There is no HioBuy service-request call in this repository.
4. Value-added services are local `vas_requests` rows (`NONE`, `REQUESTED`, `PROCESSING`, `COMPLETED`, `CANCELLED`). Upstream `/v1/fulfillment/service-requests` is not called. Treat remote VAS as Planned. Customers cannot request a service yet: the package page has no services card and the assistant has no service tool. Staff can still record one from the admin package page.

### Refund

1. An admin refunds from Payments with an amount that does not exceed the original payment minus earlier refunds.
2. Wallet payments credit `wallets` and insert `refund_records`.
3. Stripe payments call `stripe.refunds.create`. A top-up refund debits the wallet first and puts the money back if Stripe fails.
4. Bank refunds record a manual `refund_records` row. A top-up bank refund also debits the wallet.
5. When the refunded total equals the original amount, `payments.status` becomes `refunded`.
6. Margin adjustments, when the freight snapshot exists, go through `shipment_earning_adjustments` in `server/earnings.ts`. The same idempotency key is written once.

## HioBuy API

Used today:

- Package detail condition, applied by the status pull
- Webhook `package.exception`

Not used:

- `POST /v1/fulfillment/returns` and the confirm or cancel routes. Planned.
- `POST /v1/fulfillment/service-requests`. Planned.

## Local data

- `packages.condition_status`, `packages.exception_status`
- `package_exceptions`
- `vas_requests` for the local service record
- `refund_records`, `payments.status`, `wallets` for the USD refund

HioBuy `payment_status` is not changed by a customer refund. If HioBuy was already paid, the CNY balance stays spent until someone handles that in the HioBuy wallet. This app does not automate that.

## HioBuy status

An exception does not set the package lifecycle to a special value. Discard and return requests use `disposition` (`RETURN_REQUESTED`, `DISPOSAL_REQUESTED`) and block consolidation. `DISCARDED` is a lifecycle value that arrives from HioBuy. This app does not offer a button that calls a discard API.

## When it fails

A second `package.exception` for a package that is already `ACTION_REQUIRED` does not insert another exception row. A refund above the remaining amount returns `INVALID_STATE`. A Stripe refund failure on a top-up restores the wallet debit.

## Code

- `applyPackageException` in `server/fulfillment-sync.ts`
- `packageEligibility` in `src/domain/status.ts`
- `refundPayment` in `server/payments.ts`
- `server/earnings.ts`
- Admin payments: `src/features/admin/AdminPayments.tsx`
