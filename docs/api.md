# API (v1)

REST + JSON under `/api/v1`. Machine-readable spec: [`openapi.yaml`](openapi.yaml). Request bodies are
validated by the Zod schemas in [`lib/validation/schemas.ts`](../lib/validation/schemas.ts).

## Conventions

- **Auth**: staff → `rs_staff` cookie (login); customers → `rs_cust` cookie (registration at a table).
  Both HttpOnly, SameSite=Lax, Secure in production.
- **CSRF**: state-changing requests must come from the app's origin (`Origin` checked) and use
  `Content-Type: application/json` (except the image upload).
- **Errors**: `{"error": {"code": "STRING", "message": "human readable", "details"?: any}}`.
  Common codes: `VALIDATION_ERROR` 400, `UNAUTHENTICATED`/`SESSION_EXPIRED`/`NO_SESSION`/`TABLE_CLOSED` 401,
  `FORBIDDEN`/`CSRF_REJECTED`/`TRANSITION_FORBIDDEN` 403, `NOT_FOUND`/`QR_INVALID` 404,
  `INVALID_TRANSITION`/`CONCURRENT_UPDATE`/`STALE_VERSION`/`PRICE_CHANGED`/`CART_INVALID`/`ALREADY_PAID` 409,
  `UNSUPPORTED_MEDIA_TYPE` 415, `REWARD_INVALID`/`OVERPAYMENT` 422, `RATE_LIMITED` 429,
  `INTERNAL_ERROR` 500 (no stack traces in production).
- **Idempotency**: `POST /customer/orders` and `POST /cashier/payments` require an `idempotencyKey`;
  approvals are idempotent by design (`alreadyApproved: true`).
- **Rate limits** (per IP for public, per session/user otherwise): login 10/10 min, QR 30/min, registration
  10/10 min, OTP 3/10 min, order create 10/5 min, quotes 120/min, service requests 8/5 min, feedback 10/10 min.

## Endpoints

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /health` | – | liveness/readiness + outbox backlog |
| `POST /public/qr` | – | validate table token, open/join visit |
| `GET /public/menu?lang=en\|hi` | – | menu with translations & availability |
| `POST /public/menu/assistant` | – | deterministic dietary assistant (never orders) |
| `GET /public/config` | – | restaurant name, currency, OTP mode |
| `GET /public/images/{name}` | – | uploaded menu images |
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | staff | staff session |
| `GET/POST/PATCH/DELETE /customer/session` | customer (POST: public) | register, read, set language, end |
| `POST /customer/session/otp`, `POST /customer/session/verify` | customer | phone verification |
| `POST /customer/cart` | customer | server-side quote |
| `GET/POST /customer/orders` | customer | visit orders / submit |
| `GET /customer/orders/{id}` | customer (owner) | status, items, bill |
| `POST /customer/orders/{id}/cancel` | customer (owner) | withdraw while pending |
| `POST /customer/orders/{id}/change-response` | customer (owner) | accept/decline proposal |
| `GET /customer/order-history`, `POST /customer/order-history/{id}/reorder` | customer | history / new cart |
| `GET /customer/rewards` | customer | rewards, balance (verified only) |
| `POST /customer/feedback` | customer (owner, served order) | ratings |
| `GET/POST /customer/service-requests`, `POST …/{id}/cancel` | customer | table service |
| `GET /customer/events` | customer | SSE |
| `GET /supervisor/orders` | `order.view` | approval queue, in-flight, flags, outbox health |
| `GET/POST /supervisor/orders/{id}` | `order.*` | detail; actions `approve`, `reject`, `flag`, `resolve-flag`, `propose-change`, `withdraw-change`, `note`, `cancel` |
| `GET /kitchen/tickets`, `POST /kitchen/tickets/{id}` | `kitchen.*` | board; `start`, `ready`, `flag`, `clear-flag`, `confirm-cancel`, `continue` |
| `GET /service/requests`, `POST /service/requests/{id}` | `service.*` | queue; `acknowledge`, `start`, `complete`, `cancel` |
| `GET /service/orders`, `POST /service/orders/{id}/serve` | `order.serve` | ready-to-serve; mark served |
| `GET /cashier/bills[?filter]`, `GET /cashier/bills/{id}` | `bill.view` | bills |
| `POST /cashier/payments`, `POST /cashier/payments/{id}/void` | `payment.record` / `payment.adjust` | record / void |
| `POST /cashier/bills/{id}/adjustments` | `payment.adjust` | discount / correction / refund |
| `GET /cashier/bills/{id}/receipt` | `bill.view` | immutable receipt |
| `GET /staff/events` | any staff | SSE |
| `/admin/menu/{categories,items,groups,reorder,reference,upload}` | `menu.manage` | menu CRUD |
| `POST /admin/menu/items/{id}/availability` | `menu.manage` or `order.change` | 86 an item |
| `/admin/tables`, `/admin/tables/{id}`, `/admin/tables/{id}/qr` | `table.manage` (close-visit/mark-clean also `service.update`) | tables & QR PNG |
| `/admin/users`, `/admin/users/{id}` | `user.manage` | staff accounts & grants |
| `/admin/settings`, `/admin/settings/taxes[/{id}]`, `/admin/rewards[/{id}]` | `settings.manage` | configuration |
| `/admin/feedback[/{id}]` | `feedback.view` / `feedback.resolve` | feedback |
| `GET /admin/orders`, `GET /admin/audit` | `order.view` / `audit.view` | search |
| `GET /admin/outbox`, `POST /admin/outbox/{id}/retry` | `outbox.manage` | dispatch monitor |
| `GET /admin/overview`, `GET /admin/analytics`, `GET /admin/analytics/export?type=` | `analytics.view` | metrics & CSV |
| `DELETE /admin/customers/{id}` | `customer.data.manage` | anonymise customer |
