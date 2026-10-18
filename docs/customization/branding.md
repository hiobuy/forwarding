# Branding and logo

> Status: Implemented

The product name and logo that customers see in email are settings, not a rebuild.

## Where to change it

Settings → Email stores:

- Platform name (`email_settings.platform_name`, default `HIOBuy`)
- Logo URL (`logo_url`). It must start with `https://`. The server rejects anything else.
- Sender name and app URL

`renderTemplate` in `src/domain/email.ts` places the logo in the HTML shell. If the URL is empty, the platform name is text instead. The logo is not drawn in the React app shell. The admin and customer marks are the letter H in `AdminShell` and `App.tsx`.

SMTP from-name falls back to `SMTP_FROM_NAME`, then the saved sender name, then the platform name.

## Compatibility

- Changing the platform name does not rename historical notification titles already stored in `notifications`.
- Replacing `BETTER_AUTH_SECRET` does not encrypt the logo URL. It does invalidate stored SMTP and Stripe secrets, which must be saved again.
- Do not put the HioBuy API key in the logo URL or the email footer.

## Code

- `src/domain/email.ts`
- `server/email/mailer.ts`
- `src/features/admin/AdminEmail.tsx`
- Customer chrome: `src/layouts/AppShell.tsx`
