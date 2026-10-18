# Demo Admin Mode

> Status: Implemented

Demo Admin lets a signed-in customer walk through the existing admin screens with a fixed fictional catalog. It is a preview of the product. It is not an admin role, and it does not read or change the business database.

Run the official demo as its own Worker and its own D1 database. A production deployment that serves real customers should leave this mode off.

## Turn it on

The server reads `DEMO_MODE`. The value must be the string `true`. Anything else, including an unset variable, keeps the mode closed. A frontend flag cannot open it.

```bash
DEMO_MODE=true
# Optional. Unset uses https://github.com/hiobuy/forwarding.
GITHUB_REPO_URL=https://github.com/hiobuy/forwarding
```

`GITHUB_REPO_URL` is used only when it matches `https://github.com/owner/repo`. A trailing slash is removed. An invalid value is ignored. When the variable is unset, the link is `https://github.com/hiobuy/forwarding`.

`wrangler.jsonc` does not set `DEMO_MODE`, so it is off unless you turn it on. Locally, put it in `.dev.vars`, which is not committed. See `.dev.vars.example`. On a deployed Worker, use a secret so the switch stays out of the repository:

```bash
npx wrangler secret put DEMO_MODE --env production   # enter: true
npx wrangler secret delete DEMO_MODE --env production # turn it off again
```

Do not also add `DEMO_MODE` to `vars` in `wrangler.jsonc`. Cloudflare rejects a secret whose name is already used by a variable.

After changing the variable, restart `npm run dev`. Check the public status route:

```bash
curl http://localhost:5174/api/demo/status
```

When the mode is off the body is `{ "data": { "enabled": false, "githubUrl": null } }`.

## Who can open it

| Visitor | What they see |
| --- | --- |
| Signed-out visitor on the public calculator | **Try Admin Demo**, which goes to `/auth/login?next=/admin/demo` |
| Signed-in customer, mode on | **Admin demo** at the bottom of the sidebar on every page, and **Explore Admin Demo** on the dashboard. Both open `/admin/demo` |
| Owner, manager, or support | No customer entry. The sidebar shows **Operations admin** instead. Opening `/admin/demo` still shows only the sample catalog |
| Anyone, mode off | No buttons. `/admin/demo` says Demo Admin is off. Demo data routes return 404 |

Login and registration keep a `next` value only for `/admin/demo` and `/auth/invite`.

## What the preview includes

`/admin/demo` reuses the admin layout, sidebar, and pages. A short banner reads:

`Demo Mode — Sample data only. Changes are not saved.`

It also links back to the customer center, and to GitHub when `GITHUB_REPO_URL` is valid.

| Area | Path | What works |
| --- | --- | --- |
| Overview | `/admin/demo` | Customers, packages, shipments, wallets, earnings, attention items, fulfillment counts |
| Packages | `/admin/demo/packages` | List, search, status filter, detail, sample sync log |
| Shipments | `/admin/demo/shipments` | List, search, filter, detail, customer payment, HioBuy payment, sample margin |
| Customers | `/admin/demo/users` | Fictional profiles and their packages, shipments, and wallet activity |
| Payments | `/admin/demo/payments` | Sample payment, top-up, and refund rows |
| Earnings | Overview gross profit | Revenue, HioBuy cost, and margin from the same shipments |
| Calculator | `/admin/demo/calculator` | Weight, country, and cargo type. Local sample rates only |
| Settings | `/admin/demo/settings` | Business, integration, destinations, pricing, HioBuy wallet, email, payments, team |
| Developer Guide | `/admin/demo/guide` | The same guide as production admin, plus the HioBuy API docs link |

Search and filters run against the sample catalog. Pricing markup, fixed markup, and the exchange rate can be changed in the browser. Refresh restores 15%, ¥5.00, and 7.2000 CNY per USD. The calculator labels every result:

`Sample rates — Not live shipping quotes`

## Sample catalog

The catalog is built in memory from a fixed seed in `src/domain/demo.ts`. It is not loaded from D1, and it does not change between refreshes. Earnings windows use `2026-10-16T15:00:00.000Z`, not the viewer's current day.

- 20 customers, member codes `DM10001` onward
- 50 packages, public ids `DP24000` onward, across the package lifecycle
- 20 shipments, public ids `HS78000` onward
- Each shipment points at packages that exist in the catalog
- Wallet debits match customer payment on those shipments
- HioBuy Pay lines up with shipments that are waiting to ship
- Gross profit is calculated from shipment revenue and cost with the same earnings helpers the real admin uses
- Sync rows include success, failure, and pending
- The sample company in Settings is Northwind Forwarding

The sidebar mark still uses the instance's public brand from `/api/branding`. On a dedicated demo instance, set that brand to the name you want visitors to see.

## Isolation

Demo Admin is the role `demo`. It is not `owner`, `manager`, or `support`, and a customer is not promoted into those roles.

`/api/demo` is a separate Hono app. While the demo shell is mounted, the browser rewrites `/api/admin/...` to `/api/demo/...` and keeps demo query results in their own cache. Leaving the demo shell stops the rewrite, so the real admin client is unchanged.

The demo role can read settings, payments, earnings, wallets, fulfillment, customers, packages, and shipments. It cannot write secrets, settings, business data, payments, shipments, packages, team membership, or assistant answers.

Allowed requests are GET, plus POST `/api/demo/calculator` for the local quote. Other writes return:

`403 Demo mode is read-only. This change is not saved.`

When `DEMO_MODE` is not `true`, every demo route except `GET /api/demo/status` returns 404. Unauthenticated calls still pass through session middleware first, so a signed-out data request is 401 before the demo router runs. `GET /api/demo/status` is public.

These actions stay off in the interface and are rejected by the server:

- Saving or replacing an HioBuy API key, and calling the HioBuy API
- Inbound notice, shipment create, HioBuy Pay, cancel, and intercept
- Wallet top-up, Stripe Checkout, bank-transfer approval, and refunds
- SMTP send, staff invites, role changes, and deletes
- Persisting business settings or uploading files

Disabled controls use a short label such as `Not saved in demo` or `HioBuy sync is off in demo`.

## Files

| File | Role |
| --- | --- |
| `src/domain/demo.ts` | Fixed catalog and query helpers |
| `src/domain/demo.test.ts` | Catalog consistency, search, quote, and access rules |
| `server/demo.ts` | `/api/demo` router and `DEMO_MODE` gate |
| `server/demo.test.ts` | Closed mode, overview, and rejected writes |
| `src/lib/api.ts` | Rewrites admin API calls only while the demo shell is mounted |
| `src/features/admin/AdminShell.tsx` | Demo route guard, banner, and link prefix |
| `src/App.tsx` | Mounts the same admin pages at `/admin` and `/admin/demo` |
| `wrangler.jsonc` | Does not set `DEMO_MODE`. Unset means off |

## Checks

```bash
npx vitest run --config vitest.config.ts src/domain/demo.test.ts server/demo.test.ts
```

With the mode on, confirm `/api/demo/overview` reports 20 customers and 50 packages, and that `/api/admin/overview` still returns the real database. POST `/api/demo/shipments/:id/hiobuy-pay`, PUT `/api/demo/settings/api-key`, and POST `/api/demo/users/:id/wallet` must be 403. With the mode off, those data routes must be 404 and the public status route must report `enabled: false`.

## Limits

- The first version does not persist demo edits and does not simulate the full warehouse state machine.
- Sample rates must not be used for a real order.
- Staff accounts do not get the customer entry, but they can open `/admin/demo` while the mode is on. They still receive only the sample catalog.
- A few write buttons that the real admin shows for other permissions stay hidden because the demo role does not have those permissions. The server rejects the write even if a control is reached.
