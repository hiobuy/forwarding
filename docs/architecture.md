# Implementation notes

How the current code draws its boundaries, so an extension does not split a ledger or rewrite a formula in the wrong place. Setup and layout are in [development.md](development.md). Package and shipment states are in the Developer Guide under [Status Reference](statuses/packages.md) and [Sync tasks and logs](architecture/sync.md).

## Who owns what

The operator owns members, package and shipment business records, the USD customer wallet, selling prices, and gross profit. HioBuy owns warehouse fulfillment: receiving, packing, outbound, and cross-border transport. The browser only calls this app's `/api/*`. The HioBuy API key exists only inside the Worker.

```text
React
  → Hono /api
    → domain rules (src/domain) and services (server)
      → D1
      → server/services/hiobuy   the only place that calls HioBuy
```

HioBuy endpoints in use:

| Purpose | Method | Path |
| --- | --- | --- |
| Probe the key, sync the warehouse | `GET` | `/v1/fulfillment/locations` |
| Sync destination countries | `GET` | `/v1/fulfillment/shipping/channels` |
| Channel detail | `GET` | `/v1/fulfillment/shipping/channels/{code}` |
| Freight quote | `POST` | `/v1/fulfillment/shipping/quotes` |
| Item attributes | `GET` | `/v1/fulfillment/shipments/item-attributes` |
| Fulfillment wallet balance and transactions | `GET` | `/v1/fulfillment/balance`, `/v1/fulfillment/transactions` |
| Create or cancel an inbound notice | `POST` / `DELETE` | `/v1/fulfillment/inbounds/create`, `/v1/fulfillment/inbounds/{id}` |
| Package list and detail | `GET` | `/v1/fulfillment/packages`, `/v1/fulfillment/packages/{id}` |
| Create, pay, cancel, intercept a shipment | `POST` | `/v1/fulfillment/shipments/create`, `.../{id}/pay`, `.../{id}/cancel`, `.../{id}/intercept` |
| Shipment list, detail, and tracking | `GET` | `/v1/fulfillment/shipments`, `.../{id}`, `.../{id}/tracking` |

These endpoints need warehouse fulfillment mode and the matching read or write scope. A self-fulfillment key gets 403. Fields follow the [HioBuy docs](https://hiobuy.com/en/api-docs/fulfillment). Do not guess a response shape in the client.

Status can be pulled by hand, and `POST /api/webhooks/hiobuy` applies seven signed event types. Paying HioBuy freight is still an operator action (`shipment_pay`). A status pull or webhook never debits the customer wallet.

## Two ledgers

The customer wallet is USD in integer cents: `$16.39` is stored as `1639`. Top-ups, freight payments, and refunds are rows in `wallets` and `wallet_transactions`. Customers top up only through Stripe Checkout or a bank transfer that an operator confirms. With neither enabled, the top-up page asks the customer to contact support and nothing is credited.

The HioBuy fulfillment wallet is CNY in integer fen. Settings → HioBuy Wallet reads the official balance and transactions. It never writes to a customer wallet and cannot top up HioBuy.

Customer payment and HioBuy payment are separate. A customer can have paid in USD while HioBuy still shows `payment_status=UNPAID`. That is a normal intermediate state, not an error.

## Pricing and gross profit

The selling price is the CNY cost plus markup, converted to USD:

```text
selling USD cents = (cost CNY fen × (1 + markup bps / 10000) + fixed CNY fen) × 10000 / rate
```

The rate is stored as CNY per USD × 10000, so `7.2000` is `72000`. Markup is in basis points, so `15%` is `1500`. The formula is in `src/domain/freight.ts`. The global rule lives in `freight_policy` and is saved from Settings → Pricing. Every channel shares it. Do not add a second per-channel markup.

Gross profit is freight collected minus cost, converted at that shipment's own rate. Cost, markup, and rate are snapshotted into `shipment_earnings` when the shipment is packed. Changing markup or rate later does not recompute history. Missing cost or rate leaves profit empty, not zero. Refunds and cost adjustments go into `shipment_earning_adjustments`, once per idempotency key. See `src/domain/earnings.ts` and `server/earnings.ts`.

A quote uses the current markup and rate. It creates no shipment, debits no wallet, and does not count toward profit. Guest and customer responses never include cost, markup, or profit. Only the admin calculator returns them. Filtering happens on the server in `src/domain/live-quote.ts` and `server/calculator.ts`.

## Countries and channels

Destination countries come from the HioBuy channel sync. The switch is `freight_areas.enabled`, managed in Settings → Destinations. A sync keeps switches that were already set. A disabled country cannot be quoted or shipped to. Channels are still synced, and a quote asks HioBuy which channels serve the destination.

Customers see a warehouse address only after a successful sync writes `warehouse_locations`. Without a connection the address is empty, so demo copy is never mistaken for a real receiving address.

## Authentication and staff

Better Auth keeps sessions in D1 with an HttpOnly cookie. Member numbers are generated on the server. The format is configurable in Settings → Advanced and customers cannot choose their own.

`/admin` requires active staff. Roles are fixed: owner, manager, and support. Each admin route checks a permission from `src/domain/staff.ts`. `ADMIN_EMAILS` only promotes the first owners while no owner exists. Admin APIs live under `/api/admin/*`.

The public calculator (`/api/shipping/calculator` with its options and channel paths) needs no session and is rate-limited by IP or user. The limiter is in memory per Worker isolate, so it slows casual abuse but is not a global quota. Use Cloudflare rate limiting rules for a hard limit. The rest of `/api/*` needs a session. `/api/dev/mailbox` exists only outside production.

## Data the operator keeps

Members, address books, customer wallet transactions, notifications, checkouts, address snapshots on shipments, freight price snapshots, invoices, country switches, markup, and the exchange rate all belong to this app.

Display numbers such as `PKG-` and `SHP-` are for people. Primary keys are internal ids, and a remote id is never derived from a display number.

Schema changes add a new `drizzle/` migration. Never edit SQL that has already been applied. Column names ending in `Fen` are integer minor units: US cents on the customer side, CNY fen where the name contains `cny`.

## Security

- `BETTER_AUTH_SECRET`, `HIOBUY_API_TOKEN`, and SMTP, Google, or Turnstile secrets belong in `.dev.vars` locally and `wrangler secret` in production.
- The HioBuy API key, SMTP password, Stripe secret and webhook secret, Google client secret, Turnstile secret, and HioBuy webhook signing secret saved from the admin are stored in D1 with AES-GCM, keyed from `BETTER_AUTH_SECRET`. Rotating `BETTER_AUTH_SECRET` means saving them again.
- The HioBuy API key is stored as `enc:v1:<last four>:<ciphertext>` in `freight_policy.api_key` (`server/api-key-seal.ts`). The API only returns the last four characters. A key saved before encryption existed is sealed the first time it is read. If the key cannot be decrypted, the app logs an error and falls back to `HIOBUY_API_TOKEN`.
- Logs may contain a request id. Do not log passwords, sessions, full API keys, or payment credentials. Sync attempts pass through `redactSensitive` first.
- Stripe and HioBuy webhooks are verified by signature. Replayed event ids are not applied twice.
