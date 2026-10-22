// Fixed-window in-memory rate limiter. Adequate for a single-instance deployment; for multiple
// instances back this with Redis/Postgres (see docs/deployment.md).

interface Bucket {
  count: number;
  resetAt: number;
}

const store: Map<string, Bucket> =
  ((globalThis as Record<string, unknown>).__rateLimitStore as Map<string, Bucket>) ?? new Map();
(globalThis as Record<string, unknown>).__rateLimitStore = store;

export interface RateLimitRule {
  name: string;
  limit: number;
  windowMs: number;
}

export function checkRateLimit(rule: RateLimitRule, subject: string, now = Date.now()) {
  const key = `${rule.name}:${subject}`;
  let bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + rule.windowMs };
    store.set(key, bucket);
  }
  bucket.count += 1;
  if (store.size > 50_000) sweep(now);
  return { allowed: bucket.count <= rule.limit, remaining: Math.max(0, rule.limit - bucket.count), resetAt: bucket.resetAt };
}

function sweep(now: number) {
  for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
}

export function resetRateLimits() {
  store.clear();
}

export const RATE_LIMITS = {
  login: { name: "login", limit: 10, windowMs: 10 * 60_000 },
  qr: { name: "qr", limit: 30, windowMs: 60_000 },
  register: { name: "register", limit: 10, windowMs: 10 * 60_000 },
  otpRequest: { name: "otp-request", limit: 3, windowMs: 10 * 60_000 },
  otpVerify: { name: "otp-verify", limit: 10, windowMs: 10 * 60_000 },
  orderCreate: { name: "order-create", limit: 10, windowMs: 5 * 60_000 },
  quote: { name: "quote", limit: 120, windowMs: 60_000 },
  serviceRequest: { name: "service-request", limit: 8, windowMs: 5 * 60_000 },
  feedback: { name: "feedback", limit: 10, windowMs: 10 * 60_000 },
  assistant: { name: "assistant", limit: 60, windowMs: 60_000 },
  staffWrite: { name: "staff-write", limit: 300, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;
