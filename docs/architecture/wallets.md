# Customer wallet and HioBuy wallet

> Status: Implemented

There are two ledgers. They are not one balance with two labels.

## Customer wallet (USD cents)

Tables: `wallets`, `wallet_transactions`. `$16.39` is stored as `1639`.

Money enters when:

- Stripe Checkout completes with `payment_status=paid`, via `POST /api/payments/stripe/webhook`
- An admin confirms a bank transfer under Payments → Pending top-ups. A screenshot is not receipt of funds
- Demo `POST /api/wallet/top-up`, only while Stripe and bank transfer are both disabled

Money leaves when the customer pays a shipment (`SHIPMENT_PAYMENT`) or an admin refunds or adjusts the balance. The admin adjustment writes a reason.

Settings → Payments stores Stripe and bank details. Secrets are encrypted with `BETTER_AUTH_SECRET`. Test mode cannot save a live key, and the reverse is also rejected.

## HioBuy wallet (CNY fen)

Settings → HioBuy Wallet calls `GET /v1/fulfillment/balance` and `GET /v1/fulfillment/transactions`. It is read-only. It does not write the customer wallet, and this app cannot top it up.

Sidebar balance uses the same read. `409` means HioBuy is not connected.

## Selling price

```text
usdCents = (cnyFen * (1 + markupBps / 10000) + fixedCnyFen) * 10000 / rate
```

The rate is CNY per 1 USD times 10000. `7.2000` is `72000`. Markup percent is basis points. `15%` is `1500`. The formula is `src/domain/freight.ts`. One policy in `freight_policy` applies to every channel. Do not add a second markup per channel.

Margin is freight actually collected minus cost converted with that shipment's own rate. The snapshot is `shipment_earnings`, written when freight is recognized. Later Settings changes do not recompute history. Missing cost or rate leaves margin empty. It is not zero. Refunds and cost adjustments append `shipment_earning_adjustments` once per idempotency key.

A calculator quote uses the current markup and rate. It does not create a shipment, debit either wallet, or enter margin. Visitor and customer responses omit cost, markup, and margin. Admins see those fields only on `/api/admin/calculator`.

## The two payments

1. Customer pays this app in USD. Local shipment status becomes `READY_TO_SHIP` when connected HioBuy is still `WAIT_PAYMENT`.
2. An admin later pays HioBuy in CNY with `POST /v1/fulfillment/shipments/{id}/pay`. Until that succeeds, `hiobuy_payment_status` stays `UNPAID`.

See [Customer payment](../workflows/customer-payment.md) and [HioBuy Pay](../workflows/hiobuy-pay.md).

## Code

- `src/domain/freight.ts`, `src/domain/earnings.ts`
- `server/earnings.ts`, `server/payments.ts`, `server/calculator.ts`
- `server/hiobuy-ledger.ts`, `server/services/hiobuy/wallet.ts`
