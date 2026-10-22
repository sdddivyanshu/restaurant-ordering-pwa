# Architecture

A **modular monolith**: one Next.js 16 application (App Router, React 19, TypeScript) serving the customer
PWA, staff dashboards, KDS, admin console and a versioned REST API, backed by PostgreSQL via Prisma 7.

```
Customer PWA (/t, /menu, /cart, /orders, /service, /rewards)      Staff (/staff/*)  Admin (/admin/*)
            │  fetch + SSE (/api/v1/customer/events)                    │ fetch + SSE (/api/v1/staff/events)
            ▼                                                           ▼
  app/api/v1/**  ── lib/http/route.ts: CSRF origin check, rate limit, Zod validation,
                    session resolution (customer / staff), RBAC, consistent errors
            │
            ▼  services (lib/**) — all business rules run on the server
  tables  customers  menu  pricing/quote  orders(submit, transition, serve, history)
  approvals  kitchen(outbox, dispatch, service)  payments  loyalty  service-requests
  feedback  analytics  admin/*  audit  notifications(bus, sse)
            │
            ▼
  PostgreSQL — orders + immutable item snapshots, status history, approvals, change requests,
  kitchen tickets, transactional outbox, payments/adjustments/receipts, loyalty ledger, audit log
```

## Key decisions

| Concern | Decision |
|---|---|
| Money | Integer paise everywhere; one pure pricing engine (`lib/pricing/calculator.ts`) with half-up integer rounding and largest-remainder discount allocation. |
| Pricing authority | The client never sends prices. `quoteCart()` loads the menu, validates availability & customisations (shared validator with the UI) and prices. Submission rejects a total that differs from the customer-confirmed one (`PRICE_CHANGED`). |
| Order integrity | `transitionOrder()` is the only status writer (state machine + compare-and-set + history + audit). |
| Kitchen delivery | Transactional outbox: approval inserts an `OutboxEvent` (unique dedupe key) in the same transaction; a dispatcher claims events with `FOR UPDATE SKIP LOCKED`, creates the single ticket and moves `APPROVED→QUEUED` atomically, retrying with exponential backoff; exhausted events become `FAILED`, are shown to admins/supervisors and can be retried. Triggered immediately after commit, plus a background worker (`instrumentation.ts` → `lib/jobs.ts`). |
| Idempotency | Order submission: unique `(customerSessionId, idempotencyKey)`. Payments: unique `(orderId, idempotencyKey)`. Approval: unique `OrderApproval.orderId`. Tickets: unique `orderId`. Loyalty: unique ledger `dedupeKey`. Service requests: advisory lock + suppression window. |
| Realtime | SSE streams per customer session / table visit / staff. Events are *hints*; clients refetch authoritative data. Clients fall back to polling while SSE is down, refetch on reconnect/focus, and ignore duplicate event ids. The bus is in-process — see "Scaling". |
| Auth | Staff: Argon2id passwords, random session tokens stored hashed, HttpOnly SameSite=Lax cookies (Secure in production), 12-hour sliding expiry, lockout after repeated failures. Customers: no password — name + mobile + consent create a session bound to the table visit; optional OTP verification. |
| Authorisation | Permission-based RBAC in the DB (`Role`, `Permission`, `RolePermission`, `UserPermission`), checked in every staff route and again in the state machine. Pages also gate server-side, but UI gating is cosmetic. |
| Customer privacy | Kitchen views carry no names/phones; full phone numbers require `customer.pii.view`; unverified customers only see orders from their own device; order access returns 404 for other customers' orders (no IDOR oracle). |
| i18n | `messages/en.json`, `messages/hi.json` for UI; DB translation tables / JSON maps for menu content; English fallback everywhere. |
| PWA | `app/manifest.ts`, generated icons, `public/sw.js` with versioned caches; only public assets & the public menu are cached; nothing is cached for APIs with personal data or for staff pages; POSTs are never intercepted. |

## Module map

```
app/(customer)        customer PWA pages          components/customer   customer UI
app/(staff)/staff     supervisor, KDS, service,    components/supervisor, kitchen, service, cashier, staff
                      cashier, receipts, login
app/(admin)/admin     admin console                components/admin
app/api/v1            REST API (see docs/api.md)   components/shared     UI primitives, i18n provider
lib/                  domain services & rules      prisma/               schema, migrations, seed
```

## Scaling notes

The MVP targets one restaurant on one app instance. For multiple instances:
- replace the in-process realtime bus with Postgres `LISTEN/NOTIFY` or Redis pub/sub (the outbox already
  guarantees delivery; only live-update latency is affected — polling fallback keeps clients correct);
- move rate limiting to Redis/Postgres;
- run the outbox worker in every instance (safe — `SKIP LOCKED`) or in a dedicated worker.
