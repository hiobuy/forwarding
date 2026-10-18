# Customer portal

> Status: Implemented

Customer routes live under `/app` in `src/App.tsx`. The shell is `src/layouts/AppShell.tsx`. Pages are `src/features/*`.

| Path | Page |
| --- | --- |
| `/app/dashboard` | Home |
| `/app/packages`, `/app/packages/pre-alert`, `/app/packages/:id` | Parcels and pre-alert |
| `/app/claim-packages` | Local unclaimed claims |
| `/app/consolidate` | Build a shipment |
| `/app/shipments`, `/app/shipments/:id` | Shipments |
| `/app/checkout/:id` | Pay freight |
| `/app/shipping-calculator` | Logged-in quote |
| `/app/warehouse` | Synced address |
| `/app/wallet` | USD wallet |
| `/app/addresses`, `/app/account` | Address book and profile |

`/` is the public website, including the shipping calculator, when `PUBLIC_SITE_MODE` is `integrated` or unset. `app-only` sends `/` to the dashboard or login and does not mount that page. `/privacy`, `/terms`, and `/app/shipping-calculator` stay available in both modes. See [Public website deployment](../getting-started/public-site.md).

## Compatibility

- Display status comes from `customerShipmentDisplay` and `getPackageDisplayStatus`. When the shipment is linked and the customer has paid, `WAIT_PAYMENT` renders as Payment Received.
- Do not show CNY cost, markup, or margin on these pages. The server already strips them. Do not add them back in the client.
- Prices on a submit body are ignored. Keep that rule if you add a field.
- Member codes and package and shipment numbers are generated on the server. Do not add an input for them. The format is Settings → Advanced → Numbering.
- Google sign-in, Turnstile, and email change are customer flows. They do not grant staff access. See [Advanced settings](advanced-settings.md).
- The assistant button follows `GET /api/security/public`. When customer AI is off, do not call `/agents/` from a new customer page. The server rejects it.

## Code

- `src/App.tsx`
- `src/layouts/AppShell.tsx`
- `server/index.ts`
- `server/data.ts`
