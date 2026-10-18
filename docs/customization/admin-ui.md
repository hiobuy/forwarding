# Admin UI

> Status: Implemented

`/admin` is `RequireAdmin` in `src/features/admin/AdminShell.tsx`. `ADMIN_EMAILS` promotes the first owners. After that, Settings → Team decides access. Owner, manager, and support are fixed roles in `src/domain/staff.ts`.

| Path | Role |
| --- | --- |
| `/admin` | Overview |
| `/admin/packages`, `/admin/packages/:id` | Packages, notice submit, status pull |
| `/admin/shipments`, `/admin/shipments/:id` | Shipments, pull, HioBuy pay, intercept |
| `/admin/users` | Customers and manual balance changes |
| `/admin/payments` | Customer payments, bank top-ups, refunds |
| `/admin/assistant` | Publish answers the assistant could not give |
| `/admin/calculator` | Same quote as the storefront, plus cost and margin |
| `/admin/settings` | Business, integration, destinations, pricing, HioBuy wallet, email, advanced, payments, tracking, team |
| `/admin/guide` | This guide. It only renders markdown. It does not call HioBuy |

The sidebar wallet link opens Settings on the wallet tab (`/admin/settings?tab=wallet`).

## Compatibility

- New admin routes belong in `src/App.tsx` under the `RequireAdmin` parent, and in the `links` array in `AdminShell.tsx`. Put rare developer tools next to Settings, not in the daily list.
- Every `/api/admin/*` handler goes through `permissionFor`. Owner-only settings use `secrets.write`. HioBuy Pay uses `shipments.pay` (owner and manager). A new handler must stay on that router and match a rule in `src/domain/staff.ts`. Numbering, Google, Turnstile, and the assistant switch are [Advanced settings](advanced-settings.md).
- Lists should use the status helpers in `src/domain/status.ts` so filters and badges stay on one map.
- Do not put the API key, webhook secret, or Stripe secret into component state that gets logged.

## Code

- `src/features/admin/AdminShell.tsx`
- `src/App.tsx`
- `server/admin.ts`
- Shared header and badges: `src/features/admin/shared.tsx`
