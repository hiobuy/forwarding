# Payment, interception, and sync

> Status: Implemented

Keep four facts on a shipment, and do not fold them into one badge.

## 1. Business status

Package lifecycle, or shipment lifecycle (`upstream_status` when linked, otherwise the local customer status).

Documented in [Package lifecycle](packages.md) and [Shipment lifecycle](shipments.md).

## 2. Payment

| Question | Where to look |
| --- | --- |
| Has the customer paid this app? | `charges.status`, checkout `PAID`, and local status no longer `TO_PAY` |
| Has HioBuy been paid? | `hiobuy_payment_status`: `UNPAID`, `PARTIAL`, `PAID` |
| Is a HioBuy pay waiting for an admin? | `payments.hiobuy_status=pending` and task `shipment_pay` in `waiting` |

Customer paid plus HioBuy `UNPAID` is a normal pause. Sync must not mark the customer unpaid, and it must not credit the customer wallet because HioBuy is paid.

## 3. Interception

`shipments.interception_status`, empty when nobody has asked.

| Code | Label |
| --- | --- |
| `REQUESTED` | Intercept requested |
| `PROCESSING` | Intercepting |
| `INTERCEPTED` | Intercepted |
| `FAILED` | Intercept failed |

The intercept call writes only `REQUESTED`. Later values come from a pull. The shipment can stay `WAIT_SHIP` or `SHIPPED` the whole time.

## 4. Sync status

On `fulfillment_sync_tasks`, not on the package or shipment lifecycle.

| Task status | Meaning |
| --- | --- |
| `local_only` | HioBuy is not connected. Nothing was sent |
| `pending` | Ready to send |
| `waiting` | Held for a missing precondition or an admin confirm |
| `syncing` | Request in flight |
| `synced` | This request finished. Not a business status |
| `failed` | This request failed. Previous business status remains |
| `needs_review` | A person must look. The row was not overwritten |
| `skipped` | Not sent, for example cancelled before create |

Admin copy for the package and shipment screens also says Not linked, Pending, Syncing, Synced, Failed, and Needs review. Those words describe the task.

## Code

- `src/domain/status.ts`
- `server/db/schema/app.ts` columns `hiobuy_payment_status`, `interception_status`
- Task table `fulfillment_sync_tasks`
