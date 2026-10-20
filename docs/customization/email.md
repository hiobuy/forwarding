# Email templates

> Status: Implemented

Templates are a fixed list in `src/domain/email.ts`. Settings → Email edits subject and body. It does not add a new template id from the form.

## Template ids

`welcome`, `verification`, `verify_new_email`, `email_changed`, `password_reset`, `package_received`, `action_required`, `service_completed`, `payment_due`, `shipment_shipped`, `shipment_delivered`, `wallet_topup`, `bank_submitted`, `bank_approved`, `bank_rejected`, `shipping_paid`, `payment_failed`, `refund_completed`.

`verification`, `verify_new_email`, and `password_reset` must keep `{{actionUrl}}` or `{{verification_url}}`. Saving a body without that link is rejected.

Placeholders are a whitelist. Unknown names such as `{{password}}` stay literal. Allowed names include `customer_name`, `business_name`, `verification_url`, `support_email`, `expiration_minutes`, `package_number`, `shipment_number`, and `action_url`, plus the older `name`, `platformName`, `detail`, and `actionUrl`. `name` and `customer_name` fill the same value. `actionUrl` and `verification_url` both become the same http(s) link. Add a label after a colon, such as `{{verification_url:Verify email}}`, and the HTML mail shows that text on a button, with the full address in small type underneath. Without a label the button says "Confirm email" or "View details". The label is escaped and limited to 40 characters. `actionUrl` and `logoUrl` pass through `safeHttpUrl`.

Business events map to those ids in `BUSINESS_EMAIL_EVENTS`. Customer notification preferences can suppress a business mail. Welcome, verification, password reset, new-email verification, and the old-address notice are not optional. Welcome goes out once, after the customer verifies the address. A Google sign-up is already verified, so it gets the welcome right away. The email-change flow is in [Advanced settings](advanced-settings.md).

## Delivery

Workers cannot open a Node `net.Socket`. SMTP uses `cloudflare:sockets` (`starttls` or implicit `tls` on port 465). Do not point it at a private address.

Environment variables override the saved SMTP password. The saved password is AES-GCM with `BETTER_AUTH_SECRET`. After rotating that secret, save the password again. The password is not returned to the browser.

`ENVIRONMENT=production` does not write `email_outbox`. Development does, so the verify page can show the link.

Messages go through `email_messages` (`queued`, `sending`, `sent`, `failed`). Each request drains the queue with `waitUntil`. An SMTP error before 5 attempts returns the row to `queued`. After that it is `failed` and can be retried from the log. A send failure does not roll back the business write that queued it. The same idempotency key is not sent twice.

The log label Accepted means the SMTP server accepted the message. It does not mean the inbox delivered it.

`DEMO_MODE=true` only sends account emails: `email.verification`, `email.change`, `email.changed`, and `password.reset`. Any other queued row is marked failed with "Demo mode only sends account emails."

## Compatibility

- New copy should keep the placeholder names. The renderer does not invent variables.
- A new event needs a new id in `EMAIL_TEMPLATES`, a default body, and a send call. Do not store HTML from the admin as unsanitized markup beyond the existing escape path.
- Business mail is sent after the request finishes. It must not block package or shipment writes.

## Code

- `src/domain/email.ts`
- `server/email/mailer.ts`
- `src/features/admin/AdminEmail.tsx`
