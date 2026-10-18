# Insufficient HioBuy wallet balance

> Status: Implemented

Official code: `INSUFFICIENT_BALANCE`, HTTP 402, on shipment pay. Source: [HioBuy errors](https://hiobuy.com/en/api-docs/errors) and the pay section of the fulfillment docs. Sandbox fixture `sb_shp_pay_insufficient` returns the same code. That fixture is for `hio_test_*` only. Do not use it to test WH-DEV.

## Two different insufficient balances

| Code path | Whose money | What the user sees |
| --- | --- | --- |
| `payCheckout` in `server/data.ts` | Customer USD wallet | "Insufficient wallet balance." HioBuy is not called |
| `interpretPayResponse` | HioBuy CNY wallet | "HioBuy fulfillment payment failed. The customer was not charged again." |
| `hiobuyPayQuote` before the call | HioBuy CNY wallet | "The HioBuy wallet does not cover this shipment." The pay request is not sent |

The admin customer-wallet adjustment uses the same `INSUFFICIENT_BALANCE` code when a manual debit would go below zero. That is also the USD wallet, not HioBuy.

## What to check

1. Confirm the failure is the HioBuy pay task (`action=shipment_pay`), not the customer checkout.
2. Settings → HioBuy Wallet. The figure is `GET /v1/fulfillment/balance` in CNY fen. This screen cannot top up.
3. Add funds in the HioBuy portal, then confirm pay again from the shipment. Customer checkout must not be run a second time.
4. If the first pay timed out, the next confirm reads the shipment. It pays again only when HioBuy is still not `PAID` and not already `WAIT_SHIP`, `SHIPPED`, or `SIGNED`.

`PARTIAL` is not insufficient funds. The quote blocks another pay until someone reviews it.

## Code

- `interpretPayResponse`, `hiobuyPayReady` in `src/domain/fulfillment-sync.ts`
- `hiobuyPayQuote`, `payHiobuyShipment` in `server/fulfillment-sync.ts`
- `server/services/hiobuy/wallet.ts`
