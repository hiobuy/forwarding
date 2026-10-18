# Payment providers

> Status: Partially Implemented

Customer collection is Stripe Checkout, a manual bank transfer, or a demo top-up. Paying HioBuy is not a customer payment provider. See [HioBuy Pay](../workflows/hiobuy-pay.md).

## Where to change it

Settings → Payments (`payment_settings`):

- Stripe secret key, webhook signing secret, and test or live mode. Test mode cannot store a live key.
- Bank account instructions. The customer upload does not credit the wallet. An admin approves it once.
- With neither enabled, the top-up page tells the customer no method is available. Nothing is credited.

Stripe webhook endpoint: `POST /api/payments/stripe/webhook`.

Listen for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.dispute.created`, and `charge.dispute.closed`.

Only `payment_status=paid` credits a top-up. The event id is stored so a retry does not credit twice.

## Adding another provider

There is no plugin table. A new provider needs a server module next to `server/payments.ts`, a webhook that does not trust the browser return URL, an idempotency key, and a `payments.method` value. Do not debit `wallets` from a React success page.

Do not merge that balance with `GET /v1/fulfillment/balance`.

## Compatibility

- Amounts are USD cents.
- Wallet pay of a shipment and Stripe pay of a shipment both end in `payments` with `hiobuy_status=pending`.
- Refunds for an unknown method should fail closed. The current branches are `stripe`, `wallet`, and bank.

## Code

- `server/payments.ts`
- `src/features/admin/AdminPayments.tsx`
- `src/features/wallet/WalletPages.tsx`
- `src/features/checkout/CheckoutPage.tsx`
