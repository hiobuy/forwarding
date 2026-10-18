# Deploy and environment

> Status: Implemented

Local development and Cloudflare Workers share the same Hono API. Vite serves the pages and `/api/*`. Data lives in D1.

## First local run

Node.js 20 or newer.

```bash
npm install
cp .dev.vars.example .dev.vars
openssl rand -base64 32
npm run db:migrate
npm run dev
```

`.dev.vars` needs at least:

```bash
BETTER_AUTH_SECRET=a long random string
# Promotes the first owner. After that, Settings → Team manages staff.
ADMIN_EMAILS=you@example.com
# Optional. A key saved in Settings → Integration wins over this variable.
# HIOBUY_API_TOKEN=
```

`npm run dev` migrates before it starts. Registration requires email verification. Without SMTP, the development mailbox stores the link in `email_outbox`, and the verify page lists it. `GET /api/dev/mailbox` exists only outside production.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local pages and Worker, after migrate |
| `npm run test` | Vitest: `src/domain/**/*.test.ts` and `server/**/*.test.ts` |
| `npm run typecheck` | TypeScript check |
| `npm run db:generate` | Generate a Drizzle migration from the schema |
| `npm run db:migrate` | Apply `drizzle/*.sql` to local D1 |
| `npm run db:reset` | Wipe local D1 and migrate again |
| `npm run build` | Production build |
| `npm run deploy` | Build with `env.production` and `wrangler deploy` |
| `npm run db:migrate:remote` | Apply `drizzle/*.sql` to the production D1 |

After a schema change, add a new migration. Do not edit a SQL file that has already been applied.

## Where configuration lives

| Item | Where |
| --- | --- |
| Environment | `vars.ENVIRONMENT` in `wrangler.jsonc`. Production must be `production` |
| D1 | Binding name `DB`. Replace `database_id` before deploy |
| Photos | R2 binding `PHOTOS`, bucket `hiobuy-forwarding-photos` |
| Assistant | `ai`, `durable_objects`, and `migrations`. A production env block does not inherit the top level |
| Currency and expiry | `appConfig` in `server/config.ts`. Customer currency is `USD` |

Optional, and empty unless you want them:

| Variable | Effect |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Customer Google sign-in. Both must be set. They override Settings → Advanced |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Customer Turnstile. Both must be set. They override Settings → Advanced |
| `CUSTOMER_AI_ENABLED` | `true` or `false` locks the customer assistant switch |
| `APP_URL`, `BUSINESS_NAME`, `BUSINESS_EMAIL` | Defaults until Settings → Business is saved |
| `TRUSTED_APP_ORIGINS` | Extra comma-separated origins that Settings → Business may save as the app URL |
| `PUBLIC_SITE_MODE` | `integrated` (default) keeps the public website. `app-only` sends `/` to the dashboard or login. See [Public website deployment](public-site.md) |
| `PUBLIC_WEBSITE_URL` | Logo, return link, and email footer. A saved business URL overrides it |
| `DEMO_MODE` | `true` skips real SMTP and refuses HioBuy Pay. Independent of `PUBLIC_SITE_MODE` |
| `SMTP_HOST` and the other SMTP variables | Override the password saved under Settings → Email |

Numbering, Google, Turnstile, and the assistant switch are documented in [Advanced settings](../customization/advanced-settings.md).

Keep secrets in `.dev.vars` or `wrangler secret`. Do not commit `.dev.vars`, `.wrangler/`, `node_modules/`, or `dist/`.

## Code

- Routes: `src/App.tsx`
- Customer API: `server/index.ts`
- Admin API: `server/admin.ts`
