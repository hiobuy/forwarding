# Duplicate webhook and retry

> Status: Implemented

Two webhooks can repeat. They use different tables and different signatures.

## HioBuy

`POST /api/webhooks/hiobuy` checks `HioBuy-Signature` against the secret on `freight_policy`. Missing secret or a bad signature returns 401 and writes nothing.

The event id is the primary key of `fulfillment_webhook_events`. If that id exists and its status is not `failed`, the handler returns 200 and does not apply the payload again. A `failed` row can be processed again, which is the retry path.

`webhookDisposition` also rejects a bad signature, ignores a duplicate, and ignores a stale status rank. Tests cover those three results in `src/domain/fulfillment-sync.test.ts`.

Handled types are only `package.received`, `package.exception`, `shipment.ready_for_payment`, `shipment.dispatched`, `shipment.delivered`, `shipment.exception`, and `balance.low`. Any other type is stored as processed and does not change a package or shipment. Extend `handleHiobuyWebhook` if you need another type. Do not apply it twice for the same event id.

Inbound create, shipment create, and shipment pay also send `Idempotency-Key`. Reuse the key only for the same logical request. On an unknown result, read the remote shipment or package instead of minting a new key. Official copy: duplicate conflicts may include `error.details.existing_resource`.

## Stripe

`POST /api/payments/stripe/webhook` verifies `stripe-signature`. The event id is recorded. A second delivery does not credit the wallet again. Only `payment_status=paid` credits a top-up.

The checkout return page does not credit anything. Reloading it is safe.

## Customer retries

`Idempotency-Key` on shipment create, wallet pay, and top-up returns the stored response. The wallet compare-and-set refuses a second debit if the balance changed.

Sync retries use `nextRetryAt` with a capped backoff. Manual retry is allowed for a `failed` task whose class is transient, rate limit, auth, unknown, or funds. A retry of HioBuy pay does not debit the customer.

## Code

- `handleHiobuyWebhook` in `server/fulfillment-sync.ts`
- `webhookDisposition` in `src/domain/fulfillment-sync.ts`
- `handleStripeWebhook` in `server/payments.ts`
- `idempotency_keys` in `server/db/schema/app.ts`
