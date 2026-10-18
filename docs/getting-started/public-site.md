# Public website deployment

> Status: Implemented

One repository can ship as a full public site, or as the customer center and admin behind an existing marketing site. `PUBLIC_SITE_MODE` chooses that. `DEMO_MODE` does not.

## Integrated

`PUBLIC_SITE_MODE=integrated` is the default. An unset or unknown value is the same.

- `/` is the built-in public website: homepage, live shipping calculator, and links to sign in or register.
- `/privacy` and `/terms` are template legal pages. They use the business name and contact details, and they stay marked as examples until the operator replaces them. A Privacy or Terms URL saved in Business Settings is used in the footer instead.
- Registration, login, the customer center, and admin stay on their current routes. `/auth/privacy` and `/auth/terms` redirect to those pages.
- Use this for the official demo and for an operator who does not have a separate website.

## App-only

`PUBLIC_SITE_MODE=app-only`

- `/` sends a signed-in visitor to `/app/dashboard` and everyone else to `/auth/login`.
- Registration, login, the customer center, and admin stay on the same routes. They are not copied.
- The built-in public homepage is not the entry. `/privacy` and `/terms` still open. The customer shipping calculator at `/app/shipping-calculator` still works.
- Use this when the operator already has a marketing site.

## External website

`PUBLIC_WEBSITE_URL=https://example.com`

This is the public website used by the brand logo, the return link, and the email footer. A URL saved under Settings → Business → Public website URL overrides it. Leave both empty and the app does not invent a product domain.

Login, registration, password reset, and welcome links stay on this deployment. Stripe returns stay on `/app/checkout/:id/return` and `/app/wallet`. Neither follows the marketing site, and neither changes with the site mode.

Set the variable in `.dev.vars` locally, or in `wrangler.jsonc` `vars` for a deployment. It is not a tenant setting.

## Code

- `src/domain/site.ts`
- `src/App.tsx`
- `server/index.ts` (`GET /api/branding` includes `siteMode`)
- `server/business.ts`
