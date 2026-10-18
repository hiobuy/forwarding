# Production checklist

> Status: Partially Implemented

The build and deploy commands exist. Collection, mail, and the live warehouse still have to be configured. This list follows the current code. Placeholder config is not a launch.

## Before go-live

1. Create a real D1 database, replace `database_id` in `wrangler.jsonc`, and migrate the production database.
2. Create the R2 bucket `hiobuy-forwarding-photos`.
3. Set secrets:

```bash
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put ADMIN_EMAILS
wrangler secret put HIOBUY_API_TOKEN
```

4. The production `ENVIRONMENT` must be `production`. `/api/dev/mailbox` then returns 404.
5. If you deploy with `--env production`, repeat `ai`, `durable_objects`, and `migrations` in that env block. The top level is not inherited.
6. Bind the live warehouse developer code in the portal, then test `hio_live_*` in Settings → Integration. WH-DEV is not a live warehouse.
7. Settings → Destinations. Enable only countries you actually ship to.
8. Settings → Pricing. Save markup and the exchange rate. Existing shipments are not recomputed with the new rate.
9. Settings → Payments. Configure Stripe or a bank account. Customers cannot top up until one is enabled.
10. Settings → Email. Fill SMTP, or set the SMTP environment variables. Sending uses Workers `cloudflare:sockets`. Accepted means the server accepted the message, not that the inbox delivered it. Security mail still sends when a customer turns business notifications off.
11. Settings → Advanced. Set member, package, and shipment numbers before customers register. Add Google or Turnstile only after Check configuration succeeds. Production rejects Turnstile test keys. If HioBuy Pay 2FA is on, each paying owner and manager needs an authenticator first. See [Advanced settings](../customization/advanced-settings.md).
12. Point the HioBuy webhook at `POST /api/webhooks/hiobuy` and save the signing secret in the fulfillment sync panel. Without a secret the route returns 401. The webhook does not replace a manual pull. It handles seven event types. Recent deliveries are listed under Webhook deliveries in the same panel. See [Sync tasks and logs](../architecture/sync.md).
13. Point the Stripe webhook at `POST /api/payments/stripe/webhook`. Only `payment_status=paid` credits the wallet. The same event id is not applied twice.

## Not available at launch

- Commercial invoices. Planned.
- Top up the HioBuy fulfillment wallet from this app. The balance is read-only.

## Code

- `wrangler.jsonc`
- `server/config.ts`
- `server/email/mailer.ts`
- `server/payments.ts`
