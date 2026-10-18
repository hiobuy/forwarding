# HIOBuy Forwarding Client

> **Archived.** This is the early V1 product specification, kept for history. It describes features that were later changed or removed, such as coupons, simulated top-ups, and customer value-added service requests. It is not maintained. For current behavior, read the [Developer Guide](../guide.md), [Local development](../development.md), and [Implementation notes](../architecture.md). When this file and the code disagree, the code is right.

## Product & Technical Requirements V1

This document is the original V1 specification. The HTML prototype in `docs/archive/prototypes/hiobuy-forwarding-v2-confirmed.html` is a UX reference, not production code.

The application is a customer-facing international parcel forwarding client on HIOBuy fulfillment infrastructure. Do not build another warehouse management system.

## 1. Project overview

Users can register and sign in, view their China warehouse address, pre-alert domestic parcels, see parcels the warehouse received, claim parcels that arrived without a pre-alert, handle exceptions, request value-added services, see weight, dimensions, photos and cargo attributes, select eligible packages for consolidation, choose an international address, query compatible shipping methods, submit a consolidation, wait for packing, pay final freight, pay several shipments in one checkout, apply promo codes, manage a wallet, track one or many shipments, estimate freight before creating a shipment, and manage addresses and account details.

Warehouse operations stay with HIOBuy.

## 2. Product principles

The primary journey is:

Register / Login → China warehouse address → buy from Chinese sellers → pre-alert → warehouse receives → package information → exception or VAS if needed → ready → consolidate and ship → select packages → select address → compatible methods → select method → submit → warehouse packs → final weight, dimensions and freight → payment → shipment → tracking → delivered.

Hide warehouse complexity.

## 3. Technical architecture

Frontend: React, TypeScript, Vite, React Router, Tailwind CSS.

Backend: Hono on Cloudflare Workers.

Database: Cloudflare D1. ORM: Drizzle. Validation: Zod.

Storage: Cloudflare R2 when photos or files require it.

Authentication: a mature Workers-compatible library with D1-backed sessions. This implementation uses Better Auth.

Deployment: Cloudflare Workers and Workers static assets through the Cloudflare Vite plugin.

Do not use Next.js. This is an authenticated application and does not need SEO-heavy SSR.

## 4. Development strategy

Phase 1 builds authentication, the app shell, every customer page, complete flows, realistic mock data, responsive UI, state handling and reusable components. Do not integrate every HIOBuy API yet. The customer experience must be usable with realistic data.

Phase 2 adds durable product data where this app is the source of truth, real authentication data, HIOBuy synchronization, VAS, shipping quotes, shipment creation, payment providers, tracking and webhooks. Keep the architecture ready for that from the start.

## 5. Authentication

Do not build password or session cryptography from scratch.

Initial method: email and password. Flows: register, login, logout, email verification, forgot password, reset password, session management. Google login may come later.

Use secure HTTP-only cookie sessions. Verification and reset tokens expire. Authentication endpoints are rate limited.

## 6. User model

Application fields: id, email, name, member code, status, phone, country, created at, updated at. Example member code: `HX10238`. The member code identifies parcels at the China warehouse. Auth tables belong to the authentication library. Do not duplicate them.

## 7. Main navigation

Desktop sidebar, in this order:

Dashboard, Packages, Claim Packages with an unclaimed badge, Consolidate & Ship, Shipments with an unpaid badge when applicable, Shipping Calculator, Tracking, Warehouse Address, Wallet, Addresses, Account.

Claim Packages is not inside Packages. An unclaimed parcel is not yet confirmed as the user's.

## 8. Dashboard

Answer what needs attention now. Do not add analytics charts.

Lead with Action Required and To Pay. Then Needs your attention. Warehouse and wallet come next: the member code is the prominent warehouse value, and Copy address is a secondary action; the balance is the prominent wallet value, and Top Up stays secondary. Example balance `$326.80`.

Ready, In Transit, To Claim and total packages are quieter counts. Every count deep-links to the filtered view.

Needs your attention: claim waiting, exception, VAS completed, shipment ready to pay, low wallet. Each item links to the action.

Recent activity: packages, shipments, wallet transactions.

## 9. Warehouse address

Show warehouse name, recipient as `Name / MemberCode`, phone, province, city, district, street, postal code, and Copy full address.

Emphasize that the member code must be in the recipient line. Also show working hours, receiving rules, prohibited items, free storage period and inbound notes.

## 10. Package pre-alert

Entry: Packages → Pre-alert Package.

Required: domestic courier, tracking number. Optional: product name, quantity, declared value, seller platform, notes.

Platforms: 1688, Taobao, JD, Pinduoduo, Other.

Success confirms the pre-alert. Duplicate tracking numbers are rejected: "This tracking number has already been pre-alerted." With one warehouse, do not ask the user to pick one.

## 11. Packages

Only parcels already associated with the user. Filters: All, In Transit to Warehouse, Action Required, VAS Processing, Ready, In Consolidation, Completed. Filters live in the URL, for example `/app/packages?status=ready`.

Each row shows package id, domestic tracking number, courier, received date, weight, dimensions, cargo, status and photo count. Example: `PKG-10301`, `YT908231002`, `1.28 kg`, `32 × 21 × 16 cm`, General, Ready.

Search matches package id, domestic tracking number and product name, and combines with the status filter.

## 12. Cargo attributes

Initial attributes: GENERAL, BATTERY, MAGNETIC, LIQUID, POWDER, SENSITIVE. A package may have more than one. Do not model cargo as a single enum forever. Attributes affect route availability.

## 13. Package detail

Basic information, warehouse measurement including volumetric weight, cargo attributes, photo gallery, product name, quantity, SKU and declared value, storage dates, free-storage remaining and storage fee, and actions that depend on state: request VAS, resolve exception, add to consolidation.

## 14. Claim packages

Separate module. The warehouse received a parcel that was not pre-alerted. The user confirms ownership. Show tracking number, courier, received time, weight, dimensions and photos. Actions: Claim this package, Not mine. After claim, the parcel becomes a normal package and appears under Packages. Claim is not a package status in the customer UI.

## 15. Package exceptions

Examples: damaged package or product, quantity or product mismatch, restricted item, missing information, oversized, overweight, unidentified contents, other warehouse issue.

Show Action Required. Detail shows type, description, photos, warehouse message and actions: accept and continue, request inspection, request return, request disposal, contact support. Disposal requires confirmation and is not one click. Return only needs a request in Phase 1, not domestic return logistics.

## 16. Value-added services

Examples: additional photos, inspection, quantity check, remove seller packaging, reinforcement, repacking, labeling, other services. The catalog and prices must come from data, not a hardcoded production catalog. States: REQUESTED, PROCESSING, COMPLETED, CANCELLED.

A package with unfinished VAS cannot be consolidated. The UI explains why. The server enforces it. Show estimated cost and final cost when known, and whether the charge is already paid or will be included on the shipment bill. Do not hardcode immediate wallet deduction versus billing on the shipment.

## 17. Consolidation eligibility

A package can be selected only when it belongs to the user, warehouse receiving is complete, there is no unresolved exception, no VAS is processing, it is not locked by another shipment, and it is not being returned or disposed. Disabled checkboxes are not enough. The server validates again when the shipment is created.

## 18. Consolidate and ship

Four-step wizard, not one large form:

1. Select packages
2. Delivery address
3. Shipping method
4. Review and submit

Going backward keeps packages, address, method and packing instructions unless a change invalidates a later step. Changing packages or address invalidates the quote and selected method. The user must query routes again.

On mobile, keep the current step, selected count and estimated weight visible, with a sticky continue action.

## 19. Step 1

Show eligible packages by default, with id, tracking number, weight, dimensions, cargo and received date, plus estimated combined weight. Unavailable packages can be revealed with the reason they cannot be selected.

## 20. Cargo compatibility

Do not hardcode compatibility in the frontend. Routes come from capabilities. Phase 1 uses a mock catalog so the UI can demonstrate the rule before HIOBuy exists. The UI says shipping methods depend on the selected combination. If no common route exists, explain that the packages cannot ship together and offer Change packages. Automatic split suggestions are out of Phase 1.

## 21. Step 2

Choose an existing international address. Show recipient, phone, country, state, city, postal code and both address lines. Allow add and edit. Country and postal code matter for the quote.

## 22. Step 3

Request methods only after packages, cargo, estimated weight, dimensions, destination country and postal code are known. Filter by destination, cargo, weight, dimensions and route availability.

Example: CJ AIR Battery Line, estimated $188–215, 5–8 business days, door to door, tracking, General and Battery supported. Another route may be Special Cargo Air at $205–238, 7–10 business days.

If none exist, say no shipping methods are available and offer Change packages and Change address. While loading, say "Finding available shipping methods…" and mention destination, cargo, weight and dimensions. If the upstream is unavailable, show a retry state, not a raw HTTP error.

Show route name, estimated freight, transit time, tracking, tax or duty note and important restrictions. Do not dump raw logistics fields.

## 23. Quote versus final freight

The price during consolidation is estimated freight, not the final amount. Final freight exists only after the warehouse picks, consolidates, repacks if needed, and measures final dimensions and weight. Do not charge the user when the consolidation is submitted. Quotes expire. Submission revalidates or regenerates the quote.

## 24. Step 4

Review packages, cargo, destination, method, estimated freight, packing instructions and outbound VAS. Packing choices include remove unnecessary seller packaging, keep original packaging, reinforce the carton, and other instructions.

Submit locks the packages, creates a shipment and starts warehouse processing. The server revalidates package availability, ownership, exceptions, VAS, locks, address, route and quote. If state changed, return `PACKAGE_STATE_CHANGED` and refresh availability.

## 25. Shipment lifecycle

Customer states: Consolidating, Waiting for Final Weight, To Pay, Ready to Ship, Shipped, In Transit, Delivered, Cancelled.

Map internal HIOBuy states in one place, `src/domain/status.ts`. Do not expose internal warehouse names. Conceptual mapping: PENDING and PACKING → Consolidating, WAIT_PAYMENT → To Pay, WAIT_SHIP → Ready to Ship, SHIPPED → In Transit, SIGNED → Delivered. Adjust the map when real API names exist.

## 26. Shipments

Filters: All, Consolidating, To Pay, Ready to Ship, In Transit, Completed. Show shipment id, package count, destination, method, final weight and dimensions, amount and status. Search by shipment id and international tracking number. Optional country and date filters can wait.

## 27. Shipment detail

Shipment id, status, created time, included packages, destination snapshot, route, transit estimate, carrier when available, final measurement, packing photos, charge breakdown and tracking after shipment.

## 28. Shipment payment

When packing is complete the shipment is To Pay. Show final weight, dimensions, freight, VAS and total. Support single and batch payment.

## 29. Batch payment

The To Pay list has checkboxes and a sticky bar: selected count, total, Pay selected. Pay selected opens checkout. Do not deduct the wallet from the list page.

## 30. Checkout

One or more shipments, subtotal, promo code, discount, total and wallet balance. If the balance covers the total, pay that amount. If not, show required, available and needed amounts, with Top Up and a way back to the same checkout.

Mobile checkout keeps a sticky pay action.

## 31. Promo codes

Phase 1 uses mock codes, but the model allows fixed amount, percentage, minimum spend, route, destination, start, expiry, maximum usage and per-user limit. Do not build a coupon admin. Codes apply to checkout, not individual packages. The server is authoritative. Never trust a frontend discount.

Mock codes: `WELCOME20` is $20 off. `FREIGHT10` is 10 percent, max $50. `OLD2025` is expired.

## 32. Wallet

Used for freight, VAS, other warehouse charges and adjustments. Show available balance and Top Up. Filters: All, Top Up, Payment, Refund, Adjustment. Transactions show description, signed amount, date and related shipment when relevant.

## 33. Wallet transactions

Types: TOP_UP, SHIPMENT_PAYMENT, VAS_PAYMENT, REFUND, ADJUSTMENT, PROMOTION.

Fields: id, user id, type, amount, currency, balance before, balance after, reference type, reference id, description, created at. References may be a shipment, package, VAS request or top-up order. Financial changes are server-side and transactional. The frontend never writes a balance.

## 34. Currency

Phase 1 is USD, displayed as $. The model can add a currency later. Do not build a multi-currency wallet now.

## 35. Wallet top up

Page flow: wallet → top up → amount → method → payment → balance updated. Providers come later. Keep them behind `PaymentService.createTopUp`, `getTopUpStatus` and `handleWebhook`. Phase 1 uses a clearly simulated provider. Do not fake a production gateway.

## 36. Tracking

A standalone query tool, not only shipment detail. Multiline input, one number per line, up to 20. Action: Track shipments.

## 37. Batch results

One scannable result per number: number, status, destination, last update, View details. Unknown numbers say Not Found. Do not expand every timeline automatically. Results stay in input order.

## 38. Tracking detail

Number, carrier or route, current status, destination, last update, then a timeline with the newest event first.

## 39. Shipping calculator

Inputs: destination country, postal code, weight, length, width, height and cargo attributes. Get rates. Label results Estimated shipping cost. Do not imply the price is final.

## 40. Addresses

Address book with edit, delete and set default. Delete asks for confirmation. Deleting the default promotes another address.

## 41. Address model

id, user id, name, phone, country code, state, city, district, postal code, address line 1, address line 2, is default, created at, updated at. Country is an ISO code such as JP, KR, US, DE, FR. Do not store only a free-form country name.

## 42. Account

Name, email, phone, country and read-only member code. Change password and logout. Do not overbuild the profile. Notification preferences can be stored without sending every channel yet.

## 43. Notifications

Events include package received, unclaimed package, exception, VAS completed, consolidation completed, ready to pay, shipped, delivered and low balance. Phase 1 uses an icon and dropdown. Business events should be able to create notifications later.

## 44. Domain objects

Keep User, Address, Warehouse, Inbound pre-alert, Unclaimed package, Package, Package exception, VAS request, Shipment, Shipping quote, Tracking, Wallet, Wallet transaction, Coupon and Checkout separate. Do not collapse them into one generic order.

## 45. Relationships

A user has addresses, a wallet and its transactions, pre-alerts, packages and shipments. A package has photos, cargo attributes, exceptions and VAS requests. A shipment has packages, an address snapshot, a shipping method snapshot, charges and tracking. A package belongs to only one active shipment.

## 46. Package locking

Submit locks selected packages onto the shipment. Locked packages cannot be selected again. If the shipment is cancelled before warehouse processing, packages are released. If processing has started, the user cannot assume cancellation is available.

## 47. Package availability

Do not create combined statuses such as RECEIVED_VAS_PROCESSING. Keep package status, exception status, VAS status and shipment lock status separate. The UI derives one label.

## 48. Address snapshot

When a shipment is created, copy the address. Later edits or deletion of the address book must not change the shipment.

## 49. Shipping method snapshot

Store route code, name, estimated transit time, estimated price, currency and description. Do not depend on the live catalog remaining unchanged.

## 50. HIOBuy boundary

HIOBuy remains responsible for receiving, inbound packages, measurements, photos, cargo classification where available, VAS execution, consolidation operations, route availability, quotations, final freight, packing, international tracking and warehouse events.

This app owns customer experience, authentication, profile, address book, workflows, customer-facing status mapping, checkout, coupons, wallet presentation, notifications and API orchestration.

## 51. HIOBuy API layer

React does not call HIOBuy. A backend client will own upstream authentication, signing, request ids, error normalization, timeouts, retries and logging. Suggested later files live under `server/services/hiobuy/`. Credentials never reach the browser.

Retry only safe reads unless a mutation has an idempotency key. Timeouts become `UPSTREAM_TIMEOUT` with a friendly retry.

## 52. API

The frontend uses this app's contract, not upstream paths. Examples: `/api/me`, `/api/warehouse`, `/api/packages`, `/api/packages/:id`, `/api/packages/prealert`, `/api/claims`, `/api/claims/:id/confirm`, `/api/packages/:id/exceptions`, `/api/packages/:id/vas`, `/api/addresses`, `/api/shipping/quotes`, `/api/shipments`, `/api/shipments/:id`, `/api/checkout`, `/api/tracking`, `/api/wallet`, `/api/wallet/transactions`.

Success shape: `{ data, requestId }`. Error shape: `{ error: { code, message, details }, requestId }`. One error structure for every endpoint.

## 53. Validation

Zod on the client where it helps, and always on the server. The server checks required tracking numbers, country codes, postal codes, positive weight, package ids, and that every address, package and shipment belongs to the current user.

## 54. Authorization

Every authenticated request checks ownership. A user cannot read another user's package, shipment, address, wallet, transaction or VAS request. Frontend routing is not authorization.

## 55. Security

HTTP-only session cookies, CSRF protection appropriate to the auth design, auth rate limits, expiring reset and verification tokens, input validation, output escaping, and no secrets in the frontend bundle. HIOBuy, email, auth and payment secrets live in Wrangler secrets. Never commit them.

## 56. Cloudflare environments

Development and production. Resources: D1, R2 when needed, Worker secrets. Schema changes go through migrations. Do not hand-edit production structure.

## 57. Drizzle

Application-owned tables live under `server/db/schema`. Do not fully duplicate HIOBuy fulfillment into D1. Persist a local copy only when there is a reason. Phase 1 persists a mock workspace so the server can enforce rules before the upstream exists.

## 58. Data ownership

This app owns preferences, the address book, coupons, local notification state and application configuration. HIOBuy will own warehouse measurements, warehouse photos, VAS execution, warehouse shipment status, final freight and tracking. Avoid unnecessary sync.

## 59. Mock data

Mocks live in `src/mocks` and are seeded into the user's workspace. Components do not embed fixture objects. IDs look like `PKG-10301`, `SHP-20391` and `HX10238`. Replacing the seed with API calls should not require a UI rewrite.

## 60. Frontend structure

Feature folders for auth, dashboard, packages, claims, consolidation, shipments, checkout, tracking, shipping calculator, warehouse, wallet, addresses and account. Shared pieces live in components, layouts, domain and types. Do not put the application in one `App.tsx`.

## 61. Reusable components

Use shared pieces where the product repeats itself: sidebar, page header, status badge, cargo badge, money, empty, loading and error states, confirm dialog, address and shipping cards, photo gallery, step wizard and a mobile action bar. Do not invent a large abstract design system first.

## 62. UI direction

Modern logistics SaaS: clean, professional, lightweight, high clarity, quiet whitespace, clear status colors, strong action hierarchy. Avoid heavy gradients, marketing cards, glassmorphism, charts and dense ERP tables.

## 63. Responsive design

Desktop is primary. Every customer page works on mobile. Check package, claim, exception, consolidation, payment and tracking must be usable. Complex rows become cards on small screens.

## 64. Loading, empty and error states

API areas show skeletons or an explicit loading label. Empty states explain the next action: pre-alert when there are no packages, a quiet empty claim list, consolidate when there are no shipments, and a not-available tracking message.

Do not use `alert()`. Use a toast, inline error or dialog. Critical errors are not toast-only. Toasts are for lightweight success such as pre-alert created, address saved, promo applied, VAS submitted and tracking completed.

## 65. Request ids and idempotency

Preserve request ids. Unexpected failures may show `Request ID: req_...`. Do not show technical detail for ordinary validation errors.

Create shipment, pay, top up and submit VAS accept an idempotency key. Buttons disable while submitting. The server rejects duplicate operations.

## 66. Batch payment safety

Before charging, revalidate every shipment: ownership, payable state, server-side amount, promo code and wallet balance. Reject stale or already paid shipments. Do not silently charge a different total. If one shipment changed, return `CHECKOUT_CHANGED` and require review.

Flow: select shipments → create checkout preview → server revalidates → apply coupon → show final total → confirm → server revalidates again → atomic wallet debit → mark shipments paid.

## 67. Checkout and atomic payment

Checkout has id, user, status, currency, subtotal, discount, total, coupon, created at and expiry. Items reference a payable object. Phase 1 items are shipments. States include DRAFT, READY, PROCESSING, PAID, FAILED, EXPIRED and CANCELLED.

Payment must not leave the wallet deducted while the shipment is unpaid, or the shipment paid while the wallet is untouched. A refund returns to the wallet and references the original shipment or checkout.

## 68. Payment result and insufficient balance

Success is its own state: shipments paid, discount, total paid, new balance, and links to shipments and the dashboard. Do not redirect away without showing the result.

Insufficient balance shows total, available and amount needed, then Top Up, and can return to the same checkout.

## 69. Charges and quotes

Charges are extensible: freight, VAS, storage, repacking, insurance, remote area, adjustment, discount. A quote can be a range, not only one price, and includes route identity, transit days, tracking, door to door, tax mode, cargo capabilities, max weight and description.

## 70. Photos and storage

Shared gallery: thumbnail, full-screen preview, previous and next. Photo types include INBOUND, VAS, EXCEPTION and OUTBOUND. Shipment detail may include the packed parcel, label or carton condition, and must tolerate no photos.

Package detail can show received date, free storage days, remaining days and storage fee. Near expiry uses warning styling.

## 71. Tracking normalization and privacy

Trim lines, drop blanks, dedupe, keep the first occurrence order, and show invalid entries separately. More than 20 numbers is an error. Do not drop the extras silently.

Normalize events to NOT_FOUND, INFO_RECEIVED, IN_TRANSIT, CUSTOMS, OUT_FOR_DELIVERY, DELIVERED and EXCEPTION. Raw event text can appear in the timeline.

A tracking number that is not the user's shipment shows logistics events only. Do not reveal full address, customer name, wallet charges, contents or owner.

## 72. Email and webhooks

`EmailService` sends verification, password reset and, later, business mail. Do not couple business logic to one provider.

Later HIOBuy webhooks arrive at `/api/webhooks/hiobuy`, signed, idempotent and logged. Duplicate "shipment packed" events must not create duplicate charges, notifications or wallet movements. A webhook event log is operational and is not a customer screen.

## 73. Logging and support

Logs may include request id, user id, operation, upstream request id, shipment id, package id and error code. Do not log passwords, session tokens, API secrets or payment credentials.

Package and shipment support actions should carry the customer-facing ids and request id so the user does not copy them by hand.

## 74. Admin

Do not build a WMS admin. Later needs may include users, package overview, claim assignment, shipment overview, wallet adjustments, coupons, basic configuration and exception assistance. That is not Phase 1.

## 75. Routes

Auth: `/auth/login`, `/auth/register`, `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password`.

App: `/app/dashboard`, `/app/packages`, `/app/packages/:id`, `/app/packages/pre-alert`, `/app/claim-packages`, `/app/consolidate`, `/app/shipments`, `/app/shipments/:id`, `/app/checkout/:id`, `/app/shipping-calculator`, `/app/tracking`, `/app/warehouse`, `/app/wallet`, `/app/wallet/top-up`, `/app/addresses`, `/app/account`.

Unauthenticated app routes go to login. Authenticated users hitting login or register go to the dashboard.

## 76. Phase 1 scenarios

Packages: ready general, ready battery, ready liquid, action required, VAS processing, locked in a shipment, still in domestic transit. One unclaimed package.

Shipments: one consolidating, two to pay, one ready to ship, one in transit, one delivered.

Routes demonstrate general-only, general plus battery and magnetic, and general plus liquid. Battery plus liquid has no shared route.

Tracking covers in transit, delivered, exception and not found.

## 77. Accessibility, time and money

Use real buttons, labels, visible focus, keyboard dialogs, and status text that does not rely only on color. Store timestamps in UTC and format them for the user. Do not store formatted strings as source data. Financial math uses integer minor units on the server.

## 78. Configuration

Keep warehouse information, free storage days, tracking batch size, currency, support email and feature flags in one config. Flags may later include wallet top-up, promo codes, batch payment, VAS, calculator and public tracking. A typed config is enough.

Phase 1 UI copy is English. Keep labels centralized enough that Chinese, Korean and Japanese can be added later. Do not implement full i18n now.

One warehouse is Shenzhen for Phase 1, but packages and pre-alerts reference a warehouse id so more warehouses can exist later.

## 79. Other product rules

Customer-facing ids such as `PKG-10301` and `SHP-20391` stay readable and separate from internal keys. External HIOBuy ids are stored for sync and are not the only customer-facing id. Tracking number alone is not the global package identity.

Lists default to newest activity first. Tracking results follow input order. Package, shipment and transaction lists are ready for pagination.

Dashboard counts deep-link. Claim and unpaid badges hide at zero.

Confirmation dialogs cover claim, cancel shipment, disposal, delete address and payment.

Onboarding after registration is a short welcome with the member id and three steps: copy the warehouse address, buy from a Chinese seller, pre-alert the tracking number. It is not a long wizard.

## 80. Phase 1 done when

A person can, with mock data:

1. Create an account and sign in.
2. View the China warehouse address.
3. Pre-alert a domestic parcel.
4. View packages.
5. Claim an unannounced parcel.
6. Open an exception package.
7. View a package with VAS processing.
8. Start consolidate and ship.
9. Select general and battery packages.
10. Choose a Japan address.
11. Load compatible routes.
12. Select CJ AIR Battery Line.
13. Review and submit.
14. See the shipment as consolidating.
15. See a shipment after packing.
16. Select two to-pay shipments.
17. Open batch checkout.
18. Apply a promo code.
19. Pay from the mock wallet.
20. See the wallet transactions.
21. Paste several tracking numbers.
22. See in transit, delivered and not found results.

## 81. Do not build yet

Complex admin, warehouse picking, scanning, bin management, real procurement, a real payment gateway, real accounting, advanced coupon management, analytics, a complex role system, automatic shipment splitting, a full notification center, full translation, a native app, or a ticketing system.

## 82. Build order

P0 foundation: Workers, React, Vite, Hono, routing, Tailwind, D1, Drizzle, auth, layout.

P0 experience: dashboard, packages, package detail, claims, consolidate and ship.

P0 money flow: shipments, shipment detail, batch payment, checkout, wallet.

P1: tracking, calculator, addresses, warehouse address, account.

P2: notifications and extra empty, error and onboarding polish.

The first milestone is the auth shell, sidebar, dashboard, packages, claims, the four-step wizard and mock route data. The important path is package → eligibility → cargo compatibility → address → route → consolidation → final freight → payment → tracking.

## 83. Implementation notes

Read this document before changing a domain rule. If an implementation differs, record why in `docs/architecture.md`. Keep the app runnable after each major stage. Prefer simple code over clever abstractions. Do not invent unpublished HIOBuy API details.
