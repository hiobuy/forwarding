# HioBuy Pay

> Status: Implemented

## Purpose

Pay the CNY fulfillment freight from the HioBuy wallet after the customer has already paid this app. An admin confirms it. Customer checkout does not call this endpoint.

## Before you start

`hiobuyPayReady` requires all of the following:

- The customer has paid (`READY_TO_SHIP`, `SHIPPED`, `IN_TRANSIT`, `DELIVERED`, or a paid payment row).
- `hiobuy_shipment_id` is set.
- Remote lifecycle is `WAIT_PAYMENT`.
- `hiobuy_payment_status` is not `PAID` and not `PARTIAL`.
- A payable CNY amount is on record. If the earning snapshot has no cost, the server reads the shipment detail once.
- The fulfillment wallet available balance covers that cost.
- No `shipment_pay` task is already `syncing`.

`WAIT_SHIP`, `SHIPPED`, or `SIGNED` is treated as already paid. The pay call is not sent again.

## Steps

1. Customer payment queues `shipment_pay` as `waiting`.
2. An admin opens the shipment and confirms pay. `payHiobuyShipment` checks the quote, then sets the task to `pending`.
3. The worker calls `POST /v1/fulfillment/shipments/{id}/pay` with the stored idempotency key.
4. On success, `hiobuy_payment_status` becomes `PAID` and upstream status moves to `WAIT_SHIP` when that is what HioBuy returns.
5. Payments → retry calls `requeueHiobuyPayment`, which only resets a paid customer payment back to `hiobuy_status=pending`. It still waits for an admin confirm.

If a previous attempt timed out, the next confirm reads the shipment first. When HioBuy already shows `PAID`, `WAIT_SHIP`, `SHIPPED`, or `SIGNED`, the local row is updated and the pay endpoint is not called again.

## HioBuy API

`POST /v1/fulfillment/shipments/{id}/pay`

Official errors used by this code:

| Code | Handling |
| --- | --- |
| `SHIPMENT_ALREADY_PAID` | Treated as success. Status becomes `WAIT_SHIP`. The customer is not charged again |
| `SHIPMENT_NOT_READY_FOR_PAYMENT` | Retry later. The warehouse is not ready |
| `INSUFFICIENT_BALANCE` | Failed. Customer wallet is not debited again |
| `404 NOT_FOUND` | Failed. The linked shipment id is unknown upstream |

Balance is `GET /v1/fulfillment/balance`.

## Local data

- `shipments.hiobuy_payment_status`
- `shipments.upstream_status`
- `payments.hiobuy_status` and `payments.hiobuy_error`
- `fulfillment_sync_tasks.action=shipment_pay`

`wallets` is not updated here. `shipment_earnings` is not recomputed from the pay response.

## HioBuy status

Before pay: `WAIT_PAYMENT` and payment `UNPAID`.
After pay: `WAIT_SHIP` is the ready-to-ship lifecycle. Payment becomes `PAID`.

`PARTIAL` stops another pay until a person reviews it.

## When it fails

A short HioBuy wallet returns "The HioBuy wallet does not cover this shipment." The customer remains paid. Top up the wallet in the HioBuy portal, then confirm again.

An unclear timeout stops a batch. Later shipments in that batch are skipped and left unpaid (`payHiobuyShipments`).

## Authenticator

Settings → Advanced → Security can require a TOTP or recovery code on each admin confirm. The code is checked in `authorizeHiobuyPay` before `payHiobuyShipment`. A passing code writes one `pay_grants` row for that staff user and that shipment. The grant lasts 2 minutes, is consumed once, and cannot authorize a second payment. Bulk pay is rejected while the switch is on. Setup, reset, and demo mode are in [Advanced settings](../customization/advanced-settings.md).

`DEMO_MODE=true` returns before the HioBuy pay call. `processDueFulfillment` does not pay a shipment whose task reason is not `admin_confirmed`.

## Code

- `hiobuyPayReady`, `interpretPayResponse` in `src/domain/fulfillment-sync.ts`
- `hiobuyPayQuote`, `payHiobuyShipment`, `queueShipmentPayments` in `server/fulfillment-sync.ts`
- `payFulfillmentShipment` in `server/services/hiobuy/fulfillment.ts`
- `server/pay-factor.ts`
