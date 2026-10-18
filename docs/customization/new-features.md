# Adding new features

> Status: Implemented

Use the layer that already owns the rule. The guide pages do not run fulfillment, and a new feature should not be implemented inside the markdown renderer.

## Where to put the change

| Change | Where |
| --- | --- |
| Selling price or margin | `src/domain/freight.ts` or `src/domain/earnings.ts`, plus a test. History stays on `shipment_earnings` |
| Quote fields | `server/calculator.ts`. Upstream HTTP stays in `server/services/hiobuy/` |
| A new HioBuy route | Confirm the official path, add a function beside `fulfillment.ts`, return it from `server/admin.ts` or `server/index.ts` by role |
| Package or shipment status text | `src/domain/status.ts` and the matching `decide*Pull`. Then the page |
| Sync behavior | Pure function in `src/domain/fulfillment-sync.ts`, test, then `server/fulfillment-sync.ts` |
| Tables | `server/db/schema`, then `npm run db:generate`. Do not edit an old migration |
| Customer page | `src/features` and `src/components` |
| Admin page | `src/features/admin`, route in `src/App.tsx`, link in `AdminShell.tsx` |
| Assistant tool | `server/assistant.ts`. Do not treat one user's chat as a site-wide answer |

## Rules that new code has to keep

- The browser calls `/api/*` only.
- Do not infer a HioBuy id from `PKG-` or `SHP-`.
- Do not mark an inbound notice as received, or a sync success as paid or shipped.
- Do not debit the customer wallet from a HioBuy status pull.
- Customer responses do not include cost, markup, or margin.
- Create, pay, and top-up accept `Idempotency-Key` and return the same result when the key repeats.
- Log a request id. Do not log passwords, session cookies, the API key, or payment secrets.

## Not a place to start

`docs/archive/requirements-v1.md` is the archived early specification. Where it disagrees with this guide, follow the code. Procurement orders, HioBuy returns, and HioBuy service requests are still Planned.

## Code

- `server/index.ts`
- `server/admin.ts`
- `src/domain/`
- `server/services/hiobuy/`
