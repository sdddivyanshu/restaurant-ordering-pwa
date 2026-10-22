# QR Restaurant Ordering PWA

A mobile-first Progressive Web App for a single restaurant: customers scan the QR code on their table,
register with name + mobile, browse a bilingual (English/हिन्दी) menu, customise dishes and order. **Every
order is reviewed by a supervisor before it reaches the kitchen.** The kitchen works from a Kitchen Display
System, staff serve and a cashier records payment — while the customer tracks it all live.

Also included: loyalty rewards, table service requests, dietary/allergen assistant, feedback, order history
with reorder, billing & receipts, an admin console with analytics and CSV export, and an audit log.

| Interface | URL |
|---|---|
| Customer PWA | `/t/<table-token>` (from a table QR) → `/menu`, `/cart`, `/orders`, `/service`, `/rewards` |
| Staff sign in | `/staff/login` |
| Supervisor approvals | `/staff/supervisor` |
| Kitchen Display System | `/staff/kitchen` |
| Floor service | `/staff/service` |
| Cashier | `/staff/cashier` |
| Admin | `/admin` |

## Stack

Next.js 16 (App Router, React 19, TypeScript) · Tailwind CSS 4 · PostgreSQL 17 · Prisma 7 (`@prisma/adapter-pg`)
· Zod 4 · Argon2id · Server-Sent Events · `qrcode` · Vitest + React Testing Library · Playwright · Docker Compose.

## Quick start (local)

Prerequisites: Node.js ≥ 20.9 (tested on 24), Docker Desktop.

```bash
npm install                       # also runs `prisma generate`
docker compose up -d              # PostgreSQL on localhost:5433 (+ restaurant_test / restaurant_e2e DBs)
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local
npx prisma migrate dev            # apply migrations to the dev database
npm run db:seed                   # DEMO data (clears the dev database first)
npm run dev                       # http://localhost:3000
```

The seed prints table QR URLs. Run `npm run qr:print` to list all of them and write print-ready PNGs to
`./qr-codes/`. To scan with a phone, set `APP_BASE_URL` in `.env.local` to your computer's LAN address
(e.g. `http://192.168.1.20:3000`), re-run `npm run qr:print`, and open the port in your firewall. Admins can
also download/print QR codes from **Admin → Tables & QR**.

### Demo accounts (development only)

Password for all: `DemoPass2026!` — accounts are flagged `isDemo` and **refused at login in production**.

| Role | Email |
|---|---|
| Administrator | admin@demo.restaurant.local |
| Supervisor | supervisor@demo.restaurant.local |
| Kitchen staff | kitchen@demo.restaurant.local |
| Cashier | cashier@demo.restaurant.local |
| Service staff | service@demo.restaurant.local |

Demo customer with 200 loyalty points: register at any table with `9800000001`, then verify on the Rewards
tab (in `OTP_MODE=dev` the code is shown on screen, clearly labelled — no SMS is sent).

All seeded data is synthetic and flagged `isDemo`; analytics can exclude it.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server (webpack; `npm run dev:turbo` for Turbopack) |
| `npm run build` / `npm start` | production build / serve |
| `npm test` | unit + component + integration tests (Vitest). Integration tests use `TEST_DATABASE_URL`: migrations are deployed and the demo seed is loaded into that database |
| `npm run test:unit` / `npm run test:integration` | subsets |
| `npm run test:e2e` | Playwright (first time: `npx playwright install chromium`). Uses `E2E_DATABASE_URL`, builds if needed, serves on :3100 |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:migrate` / `db:deploy` / `db:seed` / `db:reset` | Prisma migrate dev / deploy / demo seed / reset + seed (destructive — dev only) |
| `npm run qr:print` | print QR URLs + PNGs |
| `npm run bootstrap` | production bootstrap of roles, restaurant and first admin (see docs/deployment.md) |

## How the core rule is enforced

> No order reaches the kitchen without authorised supervisor approval of the final order version.

- Orders are created only as `PENDING_APPROVAL`; the KDS reads only `KitchenTicket`s.
- Tickets are created only by the transactional-outbox dispatcher for `APPROVED` orders, for exactly the
  approved version, once (unique constraint), with retries and admin-visible failures.
- Approval needs `order.approve` (checked in the route and the state machine), locks the order row, pins the
  version, and is idempotent. Supervisor change proposals require explicit customer acceptance and return
  the order to `PENDING_APPROVAL`.

Details: [docs/order-state-machine.md](docs/order-state-machine.md).

## Documentation

- [Architecture](docs/architecture.md) · [Database](docs/database.md) · [API](docs/api.md) +
  [OpenAPI](docs/openapi.yaml) · [Order state machine](docs/order-state-machine.md) ·
  [Business rules & metric definitions](docs/business-rules.md) · [Deployment](docs/deployment.md)

## Troubleshooting

| Problem | Fix |
|---|---|
| `Can't reach database server at localhost:5433` | `docker compose up -d`; check `docker ps` shows `restaurant-pwa-postgres` healthy. |
| Port 5432 conflicts | Compose maps Postgres to **5433** on purpose; keep `DATABASE_URL` on 5433. |
| Tests fail with "TEST_DATABASE_URL is not set" | Copy `.env.example` to `.env.local`. |
| `restaurant_test` does not exist | The init script runs only on a fresh volume: `docker compose down -v && docker compose up -d`. |
| Turbopack "outside configured roots" panic | Happens when the project lives in an app-virtualised/redirected folder; the default scripts use webpack. |
| Staff login says demo accounts disabled | You are running in production mode; demo logins require `ALLOW_DEMO_ACCOUNTS=true` (never in real production). |
| Phone can't open QR link | Set `APP_BASE_URL` to your LAN IP, re-run `npm run qr:print`, allow the port through the firewall. |
| Service worker caching in dev | The SW registers only in production builds (or with `?sw=1`). |
| `pg` "client.query() when already executing" deprecation warning | Emitted inside Prisma's pg adapter; harmless. |

## Known limitations

- Payments are recorded manually (cash / UPI to VPA / card terminal) — no gateway; nothing is claimed as verified.
- SMS OTP provider is an integration point only (`OTP_MODE=provider` returns 501 until implemented).
- Realtime bus and rate limiter are in-process: one app instance unless swapped for Redis/Postgres (see docs).
- Receipt numbers are random per day (`RCPT-YYYYMMDD-XXXXX`), not a gap-free sequence; GST invoicing rules
  must be validated for your jurisdiction. This project makes no regulatory-compliance claim.
- Retention-based automatic anonymisation is not scheduled; anonymisation is available on demand (API).
