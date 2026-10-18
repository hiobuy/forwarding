# System architecture

> Status: Implemented

The browser talks only to this app. The HioBuy API key never leaves the Worker.

```text
React
  → Hono /api
    → domain rules (src/domain) and services (server)
      → D1
      → server/services/hiobuy    server-side calls to HioBuy only
```

Successful JSON is `{ "data": {}, "requestId": "req_..." }`. Failures are `{ "error": { "code", "message", "details" }, "requestId": "..." }`. The same id is on `x-request-id`.

## Who may call what

| Caller | Routes |
| --- | --- |
| Public | `/`, `/api/shipping/calculator` and its options and channel paths |
| Signed-in customer | `/app/*` and the rest of `/api/*` |
| Staff | `/admin/*` and `/api/admin/*`, for active staff. Each route also checks the role permission |
| Stripe | `POST /api/payments/stripe/webhook`, signature checked, no session |
| HioBuy | `POST /api/webhooks/hiobuy`, signature checked, no session |
| Development only | `GET /api/dev/mailbox`. Returns 404 when `ENVIRONMENT=production` |

`ADMIN_EMAILS` only promotes the first owners while no owner exists. After that, Settings → Team decides who is staff and which role they hold (owner, manager, or support). `/admin` for a signed-in user who is not active staff shows an explanation. The API returns 403. Permissions per route are in `src/domain/staff.ts`.

## Layers to keep apart

Pages in `src/features` arrange data. Eligibility, markup, exchange rate, selling price, and margin live in `src/domain` and run on the server. A new domain function needs a test under `npm run test`.

Do not recalculate a price in a React component. Do not call `api.hiobuy.com` from React.

## Related pages

- [Responsibilities](responsibilities.md)
- [Data model](data-model.md)
- [API client](api-client.md)
- [Sync tasks and logs](sync.md)
- [Customer wallet and HioBuy wallet](wallets.md)
