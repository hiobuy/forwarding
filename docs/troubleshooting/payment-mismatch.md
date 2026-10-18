# Payment state mismatch

> Status: Implemented

Customer USD and HioBuy CNY are supposed to disagree for a while. Treat a mismatch as a bug only when one of the rules below breaks.

## Expected combinations

| Customer | HioBuy lifecycle | HioBuy payment | Meaning |
| --- | --- | --- | --- |
| Not billed, local `CONSOLIDATING` | `PENDING` | `UNPAID` | Warehouse has not finished packing |
| Due, local `TO_PAY` | `WAIT_PAYMENT` | `UNPAID` | Packed. Customer has not paid this app |
| Paid, local `READY_TO_SHIP` | `WAIT_PAYMENT` | `UNPAID` | Customer paid. Admin has not paid HioBuy. UI label: Payment Received |
| Paid, local `READY_TO_SHIP` | `WAIT_SHIP` | `PAID` | HioBuy paid. Waiting for dispatch |
| Paid, local `IN_TRANSIT` | `SHIPPED` | `PAID` | Dispatched |

`WAIT_PAYMENT` never means "customer unpaid" by itself. `WAIT_SHIP` is the ready-to-ship lifecycle.

## Conflicts the code already stops

- Pull of `WAIT_PAYMENT` does not set a paid shipment back to `TO_PAY` (`applyShipmentRemote`).
- A new payable USD amount that differs from the current due charge becomes Needs review (`readyForPaymentDecision` kind `review`). The old bill stays.
- Dispatch before local payment is allowed stores upstream `SHIPPED` and opens `shipment_refresh` for review. The wallet is not charged.
- `PARTIAL` refuses another HioBuy pay.
- HioBuy `PAID` does not credit or debit the customer wallet during a pull.
- A customer refund does not set `hiobuy_payment_status` to `UNPAID`.

## What to compare

1. `charges.status` and `checkouts.status` for the customer.
2. `payments.hiobuy_status` (`pending` until an admin pay confirms).
3. `shipments.upstream_status` and `shipments.hiobuy_payment_status`.
4. The `shipment_pay` task reason.

If the customer is paid and the task says waiting for an admin, the system is consistent. Confirm HioBuy Pay. Do not refund the customer to "reset" HioBuy.

## Code

- `customerShipmentDisplay`, `customerPaymentLabel`, `hiobuyPaymentLabel` in `src/domain/status.ts`
- `applyShipmentRemote`, `readyForPaymentDecision` in `server/fulfillment-sync.ts` and `src/domain/fulfillment-sync.ts`
