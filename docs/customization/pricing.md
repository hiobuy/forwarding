# Shipping pricing

> Status: Implemented

One markup and one exchange rate apply to every channel. Settings → Pricing writes `freight_policy`. Settings → Destinations writes `freight_areas.enabled` and does not price anything.

## Where to change it

| Goal | Change |
| --- | --- |
| Percent markup, fixed CNY, or the USD rate | Settings → Pricing, or `src/domain/freight.ts` if the formula itself changes |
| Which countries can be quoted | Settings → Destinations |
| Hide a channel | Not a local switch. HioBuy returns the channels for that destination. The admin no longer toggles channels one by one |
| Historical margin | Do not recompute. Read `shipment_earnings` |

`sellingPolicy` in `server/freight.ts` reads `freight_policy` only. There is no per-channel markup.

Add a test in `src/domain` when you change the formula. Visitor and customer calculator responses must still omit cost and margin. Filtering happens in `server/calculator.ts`, not in the component.

## Compatibility

- Basis points and the rate scale (`72000` means `7.2000`) are stored as integers. Do not store a float yuan amount in those columns.
- A quote does not freeze the policy onto a shipment until freight is recognized.
- Closing a country must be honored by both the calculator and `createShipment`.

## Code

- `src/domain/freight.ts`
- `src/domain/earnings.ts`
- `server/freight.ts`
- `server/calculator.ts`
- `src/features/admin/AdminSettings.tsx`
