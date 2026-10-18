# Advanced settings

> Status: Implemented

Settings → Advanced is owner-only (`secrets.write`). It has four groups: Numbering, Authentication, Security, and Features. Email templates stay in [Email templates](email.md).

Environment variables override the saved row and lock the matching fields. A bad optional setting must not take admin login down. See [Deploy and environment](../getting-started/deploy.md).

The tables are in [Data model](../architecture/data-model.md).

## Numbering

Member, package, and shipment display numbers are `prefix + zero-padded sequence`. Prefix may be empty. Allowed prefix characters are `A–Z`, `0–9`, and `-`, at most 8. Digit length is 4–10. The starting number must fit that length.

Defaults match numbers issued before this screen existed: member `HX` / 5 / 10238, package `PKG-` / 5 / 10001, shipment `SHP-` / 5 / 20001. The first load moves the next value past numbers already in the database.

Rules:

- The server allocates the number. Clients cannot submit a public id.
- Allocation is `UPDATE number_sequences SET next_value = next_value + 1 ... RETURNING`. A formatted id that already exists is skipped, up to 8 times.
- Saving a start that would collide moves the next value to `max(requested, highest used + 1)`. A prefix change only looks at ids with the new prefix.
- Old public ids stay. `user.id`, package and shipment primary keys, and HioBuy remote ids stay. Do not join on the display number.

## Google sign-in

Customer Center only. A Google account is linked by the Google subject id on `account.provider_id = google`. The same email does not merge an existing password account (`disableImplicitLinking`). Signup does not insert `staff_members`.

Redirect URI is `{origin}/api/auth/callback/google`. It is shown read-only. The flow is authorization code with PKCE. better-auth checks the ID token signature, issuer, audience, and expiry. It does not set a separate nonce flag.

Bind from Account with `linkSocial`. Unlink requires the current password and is refused when the user has no password. Client secret is AES-GCM with `BETTER_AUTH_SECRET` and is never returned.

Check configuration posts a fake code to Google's token endpoint. `invalid_grant` or `invalid_request` means the client credentials were accepted. `invalid_client` means they were rejected.

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` together override the saved secret.

## Turnstile

Siteverify runs on the server for customer login, registration, and optionally forgot password. The widget token is sent as `x-turnstile-token`. Its hash is stored in `turnstile_tokens` before siteverify. A unique conflict is a replay.

Production (`ENVIRONMENT=production`) rejects Cloudflare's documented test key prefixes `1x`, `2x`, and `3x` followed by `00000000000000000000`.

`invalid-input-secret`, `missing-input-secret`, and `internal-error` still allow an active owner email through, so a bad secret does not lock the owner out of admin. A missing or invalid token fails everyone, including the owner. Admin login does not use this widget. Login rate limits stay on.

`TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` together override the saved secret.

## Customer AI

`customerAiEnabled` defaults to on. `CUSTOMER_AI_ENABLED=true` or `false` overrides the switch and locks it.

Off: the customer shell hides the assistant, and `/agents/` returns 403. Admin → Assistant and its history stay available.

The customer assistant copy in `src/features/assistant/AssistantPanel.tsx` is English. Do not add a second translation catalog. A customer may still type another language. See [Localization](localization.md).

## HioBuy Pay 2FA

The switch is `Require 2FA for HioBuy payments`. It uses the existing authenticator (TOTP and one-time recovery codes), not email codes.

When it is on:

- Owner and manager must enroll under Settings → Team before `POST /api/admin/shipments/:id/hiobuy-pay` runs.
- The request body is `{ code }`. The server verifies it. The dialog is not the check.
- A success writes `pay_grants` for that staff user and that shipment. The grant lasts 2 minutes and is consumed once, immediately before the HioBuy pay call.
- The same code cannot authorize another payment until that grant expires.
- Five failed attempts in 10 minutes stop further tries.
- Bulk pay returns 403. Pay one shipment at a time.
- Owner and manager cannot call `/two-factor/disable` while the switch is on. Another owner resets a member with `POST /api/admin/team/:userId/reset-2fa` (`team.manage`). That deletes the factor row and writes `staff.2fa.reset`. Self-reset is refused.

`DEMO_MODE=true` throws before any HioBuy pay, including a task that already has a grant. Scheduled fulfillment does not promote `shipment_pay` unless the reason is `admin_confirmed`. This switch does not add automatic pay. The pay steps themselves are in [HioBuy Pay](../workflows/hiobuy-pay.md).

## Customer email change

The verified address changes only after the new address confirms.

1. Account asks for the new email and re-checks the current password. A Google-only account gets a 6-digit code at the current address (10 minutes, 3 per hour).
2. The new address gets `verify_new_email`. The token is 32 random bytes, stored as `sha256(secret:token)`, valid for 1 hour, and single-use. Send rate is 5 per hour.
3. The inbox link opens `/auth/confirm-email`, which `POST`s `/api/account/email/confirm`. A GET would let a mail prefetch consume the token.
4. On success the server updates `user.email`, deletes every session, sends `email_changed` to the old address, and clears the pending row.

The old address stays valid until that success. An address already used by another account is rejected. Security mail ignores notification preferences. Welcome, verification, and password reset do too.

## Code

- `server/platform.ts`, `server/advanced.ts`, `server/numbering.ts`, `server/pay-factor.ts`, `server/email-change.ts`
- `src/domain/numbering.ts`, `src/domain/security.ts`
- `src/features/admin/AdminAdvanced.tsx`
- `server/auth.ts`
