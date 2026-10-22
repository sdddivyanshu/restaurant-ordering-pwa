# Deployment

Nothing in this repository has been deployed; this is the recommended production setup.

## Target topology

- **App**: the Docker image in `Dockerfile` (Node 22, `next start`, non-root) on any container platform
  (ECS/Fargate, Cloud Run, Fly.io, Kubernetes, a VM with Docker), or a Node-capable Next.js host that supports
  long-lived connections (SSE) and Node runtime route handlers. Start with **one** instance (see scaling).
- **Database**: managed PostgreSQL 15+ (RDS, Cloud SQL, Neon, Supabase, Azure) with automated backups and PITR.
- **TLS**: terminate HTTPS at a load balancer / reverse proxy. The PWA, Secure cookies and the service
  worker require HTTPS. Forward `X-Forwarded-For` and set `TRUST_PROXY=true` so rate limits use client IPs.
  Disable proxy buffering for `/api/v1/*/events` (SSE).
- **Uploads**: mount a persistent volume at `UPLOAD_DIR` (default `/data/uploads`) or replace
  `lib/security/uploads.ts` with object storage (S3/GCS) — optional.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Use the pooled URL (PgBouncer / provider pooler). Size `DATABASE_POOL_MAX` (default 10) × instances below the DB limit. |
| `APP_BASE_URL` | yes | Public `https://` origin — embedded in QR codes and used for the CSRF origin check. |
| `APP_SECRET` | yes | ≥ 32 random chars (HMAC for OTPs). Rotate by deploying a new value; outstanding OTPs become invalid. |
| `OTP_MODE` | no | `disabled` (default in production unless `provider`), `provider`. `dev` is ignored in production. |
| `ALLOW_DEMO_ACCOUNTS` | no | Leave unset/false. Demo accounts are refused at login in production. |
| `OUTBOX_POLL_INTERVAL_MS` | no | Background dispatcher interval (default 3000). |
| `UPLOAD_DIR` | no | Persistent path for menu images. |
| `TRUST_PROXY` | no | `true` behind a proxy that sets `X-Forwarded-For`. |
| `DISABLE_BACKGROUND_JOBS` | no | `true` on instances that should not run the worker. |

Never commit real values; use the platform's secret manager.

## Release procedure

1. Build: `docker build -t restaurant-ordering:<version> .`
2. Back up the database (provider snapshot).
3. Run migrations as a one-off task with production env: `npx prisma migrate deploy` (never `migrate dev`
   or `migrate reset` against production).
4. Roll out the new image; health check `GET /api/v1/health` (checks DB and reports outbox backlog).
5. **Do not run `npm run db:seed` in production** — it refuses unless `ALLOW_DEMO_SEED=true`, and it clears data.

## Staff provisioning

Production starts with no users. After migrations, run the idempotent, non-destructive bootstrap once
(roles & permissions, restaurant record with default settings and GST 5%, first administrator):

```
ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='<long unique password>' RESTAURANT_NAME='My Restaurant' npm run bootstrap
```

Then add other staff in **Admin → Staff & roles**. Use unique, strong passwords (≥ 12 chars); consider SSO
in front of the staff area for larger operations.

## Backups & restore

- Enable daily automated backups + point-in-time recovery (≥ 7 days).
- Restore drill: restore a snapshot into a new instance, point a staging deployment at it, run
  `prisma migrate deploy`, verify `/api/v1/health` and a test order end-to-end.
- Uploaded images: back up the upload volume or bucket with versioning.

## Logging, monitoring, errors

- App logs go to stdout; API errors log only the message (no bodies, passwords, OTPs or phone numbers).
  Production error responses never include stack traces.
- Monitor: `/api/v1/health` (uptime), `outbox.failed` > 0 and `outbox.stuck` > 0 (alert — approved orders
  waiting for the kitchen), p95 latency of `POST /customer/orders` and `/supervisor/orders/{id}`, 5xx rate,
  DB connections.
- Error monitoring: add Sentry/OpenTelemetry via `instrumentation.ts` (optional; not bundled).
- The **Audit log** (Admin) records approvals, rejections, price changes, substitutions, cancellations,
  payments/adjustments, exports and configuration changes.

## PWA

- Served over HTTPS, `app/manifest.ts` + icons in `public/icons`, service worker `public/sw.js`.
- Bump `VERSION` in `public/sw.js` when changing caching behaviour to evict old caches.

## Scaling beyond one instance

- Realtime: replace `lib/notifications/bus.ts` with Postgres `LISTEN/NOTIFY` or Redis pub/sub.
- Rate limiting: back `lib/security/rate-limit.ts` with Redis.
- Outbox: safe to run on all instances (`FOR UPDATE SKIP LOCKED`) or in one dedicated worker.

## Optional external services

| Service | Status | Integration point |
|---|---|---|
| SMS/OTP provider | not integrated | `requestOtp()` in `lib/customers/service.ts` (`OTP_MODE=provider`) |
| Payment gateway / UPI collect | not integrated | `PaymentProvider` in `lib/payments/provider.ts`; record with `providerVerified=true` only after webhook verification |
| Object storage for images | optional | `lib/security/uploads.ts` |
| LLM menu assistant | not used | the assistant is deterministic; any LLM must stay server-side and grounded in menu records |
