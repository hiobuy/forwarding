# Customer payment

> Status: Implemented

## Purpose

Collect USD freight from the customer into this app. This payment does not call HioBuy's pay endpoint.

## Before you start

- The shipment's local status is `TO_PAY`.
- A `DUE` freight charge exists. That charge is written when HioBuy reaches `WAIT_PAYMENT` and returns a payable CNY amount, which this app converts to USD.
- The checkout has not expired (`appConfig.checkoutTtlMs`).

`WAIT_PAYMENT` on HioBuy is the signal that the warehouse finished packing and is waiting for fulfillment freight. It is not, by itself, proof that the customer has not paid.

## Steps

1. Webhook `shipment.ready_for_payment`, or a shipment detail pull, runs `readyForPaymentDecision`.
2. For a shipment still consolidating, the server replaces the estimated freight with a `DUE` charge and sets local status to `TO_PAY`. Upstream status becomes `WAIT_PAYMENT`.
3. The customer opens checkout: `POST /api/checkout` then `POST /api/checkout/:id/pay` (wallet) or `POST /api/checkout/:id/stripe`.
4. Wallet pay debits `wallets` in one compare-and-set update, marks charges `PAID`, marks the checkout `PAID`, and sets the local shipment to `READY_TO_SHIP`.
5. If HioBuy is connected, `upstream_status` is set to `WAIT_PAYMENT` on that same update. If it is not connected, the code writes `WAIT_SHIP` locally. Neither write pays HioBuy.
6. `recognizeCheckoutPayment` snapshots margin. `recordWalletShipmentPayment` inserts `payments` with `hiobuy_status=pending`.
7. `queueShipmentPayments` inserts `shipment_pay` as `waiting` with the reason "Waiting for an admin to pay HioBuy."

Stripe shipment checkout credits only after the webhook reports `payment_status=paid`. The return page is a display. It does not credit the wallet by itself.

## HioBuy API

None on the customer pay path.

The amount originated earlier from shipment detail `amount_due` / `total.payable` (CNY fen). See [HioBuy Pay](hiobuy-pay.md).

## Local data

- `wallets.balance_fen` decreases by the USD total
- `wallet_transactions` type `SHIPMENT_PAYMENT`
- `charges.status=PAID`, `checkouts.status=PAID`
- `shipments.status=READY_TO_SHIP`
- `payments.hiobuy_status=pending`
- `shipment_earnings` snapshot

An idempotency key on pay returns the same checkout result. A second debit is not applied.

## HioBuy status

Unchanged by this step. The customer can be paid while HioBuy `payment_status` is still `UNPAID` and the lifecycle is still `WAIT_PAYMENT`.

The customer UI calls that combination Payment Received (`customerShipmentDisplay` in `src/domain/status.ts`). The admin payment column shows Customer paid and HioBuy unpaid together. That pair is expected.

A later pull does not move a paid shipment back to `TO_PAY` just because the remote status is still `WAIT_PAYMENT`.

## When it fails

| Code | Meaning |
| --- | --- |
| `INSUFFICIENT_BALANCE` | Customer USD wallet is short. HioBuy is not involved |
| `CHECKOUT_EXPIRED`, `CHECKOUT_CLOSED`, `CHECKOUT_CHANGED` | Review the bill. Nothing was debited |
| `SHIPMENT_NOT_PAYABLE` | Local status is not `TO_PAY` |
| Amount mismatch on `ready_for_payment` | Task `shipment_refresh` goes to Needs review. The previous due amount is kept |

A failed HioBuy pay later does not debit the customer again.

## Code

- `payCheckout`, `createCheckout` in `server/data.ts`
- `readyForPaymentDecision` in `src/domain/fulfillment-sync.ts`
- `recognizeCheckoutPayment` in `server/earnings.ts`
- `recordWalletShipmentPayment`, `handleStripeWebhook` in `server/payments.ts`
- Pages: `src/features/checkout/CheckoutPage.tsx`, `src/features/admin/AdminPayments.tsx`
