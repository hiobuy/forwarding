# Local development

How to run the project, where the code lives, and which layer to change when you extend it. Business boundaries are in [architecture.md](architecture.md). The [Developer Guide](guide.md) covers each workflow in detail and is also rendered at Admin → Developer Guide.

## Requirements

- Node.js 20 or newer
- npm

Wrangler is a dev dependency, so no global install is needed. Local D1 lives in `.wrangler/`, which is not committed.

## First run

```bash
npm install
cp .dev.vars.example .dev.vars
openssl rand -base64 32   # paste into BETTER_AUTH_SECRET
npm run dev
```

Minimum `.dev.vars`:

```bash
BETTER_AUTH_SECRET=a long random string
# Promotes the first owner. After that, Settings → Team manages staff.
ADMIN_EMAILS=you@example.com
# Optional. A key saved in Settings → Integration wins over this variable.
# HIOBUY_API_TOKEN=
```

`npm run dev` applies migrations first (`predev`), then serves pages and `/api/*` from one `vite dev` process. Every optional variable is listed in [`.dev.vars.example`](../.dev.vars.example) and [Deploy and environment](getting-started/deploy.md).

## Registration and the development mailbox

Registration needs an email, a name, and a password of at least 8 characters. The workspace opens after email verification. The welcome email is sent after verification, or right away for Google sign-in.

Without SMTP in development, verification and reset links are still written to `email_outbox`, and the verify and forgot-password pages list them:

```text
GET /api/dev/mailbox?email=you@example.com
```

This route returns 404 when `ENVIRONMENT=production`.

## Email

Workers cannot use Node's `net.Socket`, so SMTP runs over `cloudflare:sockets` with TLS or STARTTLS. Configure SMTP in Settings → Email or with environment variables. Environment variables win. The saved password is encrypted with `BETTER_AUTH_SECRET` and never returned to the browser. Rotating that secret means saving the password again.

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_ENCRYPTION=starttls   # or tls for implicit TLS on 465
SMTP_USERNAME=apikey
SMTP_PASSWORD=secret
SMTP_FROM_EMAIL=noreply@example.com
SMTP_FROM_NAME=HIOBuy
# SMTP_REPLY_TO=support@example.com
# APP_URL=https://example.com
```

Private network hosts are refused. Sent means the SMTP server accepted the message, not that it reached the inbox. Business mail is sent after the response, so it never blocks a package or shipment action.

## Customer payments

The customer wallet is USD and is separate from the HioBuy fulfillment wallet. Settings → Payments configures Stripe and a bank account. Keys are stored encrypted on the server. Test mode refuses live keys and the other way around.

Stripe uses hosted Checkout. The success page only shows the result. Money is credited by `POST /api/payments/stripe/webhook`. Point a Stripe webhook at that URL for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.dispute.created`, and `charge.dispute.closed`, and save the signing secret in settings. Only `payment_status=paid` credits the wallet, and an event id is applied once.

Card top-up is off until an operator enables it. A bank transfer adds balance only after an operator confirms it in Payments → Pending top-ups, once per request. A screenshot or reference number is not a receipt of funds. With neither method enabled, the top-up page asks the customer to contact support.

After a customer pays freight, paying HioBuy is a separate operator step (HioBuy Pay). A fulfillment failure never charges the customer again.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Migrate local D1, then start Vite and the local Worker |
| `npm run test` | Vitest over `src/domain/**/*.test.ts` and `server/**/*.test.ts` |
| `npm run typecheck` | `tsc -b` |
| `npm run build` | Production build |
| `npm run preview` | Build, then preview |
| `npm run db:generate` | Generate a Drizzle migration from `server/db/schema` |
| `npm run db:migrate` | Apply `drizzle/*.sql` to local D1 |
| `npm run db:reset` | Wipe local D1 and migrate again. Accounts, packages, and the HioBuy connection are removed |
| `npm run deploy` | Build with `CLOUDFLARE_ENV=production` and `wrangler deploy` |
| `npm run db:migrate:remote` | Apply `drizzle/*.sql` to the production D1 |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |

Tests use `vitest.config.ts`. Do not let tests load `vite.config.ts`, which carries the Cloudflare plugin.

After a schema change, run `npm run db:generate`, read the SQL, then `npm run db:migrate`. Never edit a migration that has already been applied anywhere.

History before v1.0.0 was squashed into `drizzle/0000_baseline.sql`. A database created before that squash cannot be upgraded in place: run `npm run db:reset` locally, and recreate a remote D1.

## Layout

```text
src/App.tsx                         Routes
src/features                        Customer and admin pages
src/features/admin                  Operator console
src/features/admin/guide            Developer Guide renderer
src/features/calculator             Calculator shared by public, customer, and admin
src/domain                          Testable money, status, quote, profit, and permission rules
server/index.ts                     Customer API and public calculator
server/admin.ts                     Admin API. Session, then staff role
server/data.ts                      Customer reads and writes
server/freight.ts                   API key, country switches, markup, and rate
server/calculator.ts                Quotes: open countries, markup, role-based field filtering
server/earnings.ts                  Freight snapshots, payment confirmation, refunds, and profit
server/hiobuy-ledger.ts             Read model for the fulfillment wallet
server/services/hiobuy              The only code that calls HioBuy
server/fulfillment-sync.ts          Notices, pulls, payment, cancel, intercept, and webhooks
src/domain/fulfillment-sync.ts      Pure rules for the above
src/domain/status.ts                Package and shipment labels
src/domain/guide.ts                 Developer Guide index
drizzle                             Committed D1 migrations
docs                                Markdown docs. The Guide renders the subfolders
```

Pages may arrange data. Eligibility, markup, rate, selling price, and profit live in `src/domain` and run on the server. Cover a new domain function with `npm run test`.

## Routes

Signed-out visits to `/app/*` go to login. Signed-in visits to login or register go to the dashboard.

Public:

- `/` is the public website with the calculator when `PUBLIC_SITE_MODE=integrated` (default). With `app-only`, `/` goes to the dashboard or login. `/privacy` and `/terms` work in both modes. `PUBLIC_WEBSITE_URL` only changes the logo, return link, and email footer. See [Public website deployment](getting-started/public-site.md).
- `/auth/login`, `/auth/register`, `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/confirm-email`, `/auth/invite`

The signed-in customer app is under `/app`: dashboard, packages and pre-alerts, claims, consolidation, shipments, checkout, calculator, warehouse address, wallet, addresses, invoice details, and account.

The operator console is under `/admin` for active staff: overview, packages, shipments, customers, payments, assistant, calculator, settings, and the Developer Guide at `/admin/guide`. `/admin/demo` is a read-only preview that only opens when `DEMO_MODE=true`.

## API

Apart from auth, health, the development mailbox, the Stripe and HioBuy webhooks, branding, and the public calculator, `/api/*` needs a session. `/api/admin/*` also needs a staff role with the route's permission. Webhooks check signatures instead of sessions.

Success is `{ "data": {}, "requestId": "req_..." }`. Failure is `{ "error": { "code", "message", "details" }, "requestId" }`. The id is also in `x-request-id`.

Main customer routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/warehouse` | Synced warehouse address. Empty until connected |
| `POST` | `/api/packages/prealert` | Pre-alert, up to 30 rows |
| `DELETE` | `/api/packages/:id` | Cancel and delete a `PENDING` package, withdrawing its HioBuy inbound notice |
| `POST` | `/api/shipping/quotes` | Consolidation quote for chosen packages and address |
| `POST` | `/api/shipments` | Submit a consolidation. The server recomputes the price |
| `POST` | `/api/checkout/:id/pay` | Pay from the USD wallet. A paid shipment is not charged again |
| `POST` | `/api/checkout/:id/stripe` | Freight Checkout. The amount comes from the server |
| `POST` | `/api/wallet/top-up/stripe` | Card top-up, when enabled |
| `POST` | `/api/wallet/bank-transfers` | Bank transfer request. Does not add balance by itself |

Calculators:

| Method | Path | Sees cost |
| --- | --- | --- |
| `GET` `POST` | `/api/shipping/calculator` with `/options` and `/channel` | No. Price, transit time, and channel notes only |
| `GET` `POST` | `/api/admin/calculator` with `/options` and `/channel` | Staff with `earnings.read` also get CNY cost and estimated profit. Other staff get the customer view |

Shipment creation and checkout payment accept `Idempotency-Key`. A repeat returns the first result. Stripe and bank top-ups are de-duplicated by event id and request id instead.

Customer amounts end in `Fen` and are US cents. HioBuy costs are CNY fen. Weight is grams. Dimensions are millimetres.

## Operator console

Put your email in `ADMIN_EMAILS`, restart, sign in with it, and open `/admin`. You become the first owner. Invite other staff from Settings → Team.

| Page | What it does |
| --- | --- |
| Overview | Customers, packages in stock, freight due, wallet totals, queues, HioBuy progress, freight profit |
| Packages / Shipments | Filter by status, open a detail, act for the customer. Payment still uses the customer wallet |
| Customers | Members and balances. Manual balance changes need a reason |
| Payments | Customer payments, bank top-up review, refunds, and disputes |
| Assistant | Publish official answers to questions the assistant could not answer |
| Calculator | The same quote as customers see, plus cost and estimated profit |
| Settings | Business, Integration, Destinations, Pricing, HioBuy Wallet, Email, Advanced, Payments, Invoicing, Tracking, Team |

Settings notes:

- The API key is stored in `freight_policy.api_key` and only its last four characters are returned. `HIOBUY_API_TOKEN` is the fallback.
- Destination switches are local. A country sync keeps existing switches.
- Pricing is one markup percentage, one fixed CNY amount, and one exchange rate for every channel.
- HioBuy Wallet is read-only.

`POST /api/admin/settings/sync/warehouse` calls `GET /v1/fulfillment/locations`. `POST /api/admin/settings/sync/channels` calls the channel list. A key without warehouse mode fails the sync, and the page shows the upstream error instead of a placeholder address.

## Signed-in assistant

The assistant lives at `/agents/forwarding-assistant/{user id}`. `server/index.ts` requires that id to be the current user. The model is Workers AI `@cf/zai-org/glm-4.7-flash`. `wrangler.jsonc` sets `ai.remote` to `true` for local development.

Pre-alert, claim, consolidation submit, and consolidation cancel ask the customer to confirm first. Payment and top-up only open the page. Warehouse services are not offered yet. Policy questions it cannot answer go to `assistant_unanswered`. Once an operator publishes an answer at `/admin/assistant` into `assistant_knowledge`, later replies use it.

Freight estimates call `calculateRates` in `server/data.ts`, which uses the same live quote and markup as the calculator. Tracking only reads the current customer's own shipments, matched by tracking number or `SHP-` number.

## Configuration

`wrangler.jsonc`:

| Key | Notes |
| --- | --- |
| `vars.ENVIRONMENT` | `production` in the production env block |
| `d1_databases[0]` | Binding `DB`, database `hiobuy-forwarding`. Use your own `database_id` |
| `ai` and `durable_objects` | Signed-in assistant. An env block does not inherit them from the top level |
| `r2_buckets[0]` | Binding `PHOTOS`, bucket `hiobuy-forwarding-photos` |

`appConfig` in `server/config.ts` holds the currency, free storage days, and quote and checkout expiry. The customer currency is `USD`.

Before a production deploy, follow the [Production checklist](getting-started/production.md).

## Where to change

- Selling price or profit formula: `src/domain/freight.ts` or `src/domain/earnings.ts`, with tests. Historical shipments keep reading `shipment_earnings`. Do not recompute them from current settings.
- Calculator: request handling and field filtering are in `server/calculator.ts`. Upstream calls stay in `server/services/hiobuy/`. Public responses never include cost.
- Which countries can ship: `freight_areas.enabled`, managed in Settings → Destinations. Quotes and new shipments both respect it.
- Pages: `src/features` and `src/components`. Do not write a second price calculation for display.
- Tables: `server/db/schema`, plus a new migration.
- A new HioBuy endpoint: confirm the path and fields in the official docs, add a function in `server/services/hiobuy/`, and expose it from `server/admin.ts` or `server/index.ts` by role. Never call `api.hiobuy.com` from React.
- Staff permissions: `src/domain/staff.ts`. Every new admin route needs a rule there.
- Assistant tools: `server/assistant.ts`. Do not treat one user's chat as a site-wide answer.
- Developer Guide pages: add the Markdown under a `docs/` subfolder and an entry in `src/domain/guide.ts`.
