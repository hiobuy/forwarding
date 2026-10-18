# Localization

> Status: Planned

The product UI is English. There is no locale catalog, no language switch, and no per-customer language column.

## What exists

- Status labels are English strings in `src/domain/status.ts`.
- Tracking event labels can be renamed under Settings → Tracking. That map is one global list in `src/domain/tracking-events.ts`, not a translation table.
- Email templates are English defaults with placeholders. An operator can rewrite the body in another language, but every customer receives that same body.
- The customer assistant in `AssistantPanel.tsx` is English. There is no language toggle. Do not add one beside the existing status and email strings. The model can still answer a question the customer wrote in another language. Admin assistant copy is separate.
- Currency display is USD for customers and CNY for the HioBuy wallet. That is a ledger split, not a locale.

## If you add a language

Keep status codes (`PENDING`, `WAIT_PAYMENT`, `SIGNED`) stable. Translate labels only. Do not store a translated code in `package_status` or `upstream_status`.

Do not fork the freight formula or the HioBuy client per language. Format money in the component from the integer cent or fen value.

A second language needs its own template body or a placeholder the renderer already escapes. Do not inject locale HTML.

## Code

- `src/domain/status.ts`
- `src/domain/tracking-events.ts`
- `src/domain/email.ts`
- `server/config.ts` (`currency: USD`)
