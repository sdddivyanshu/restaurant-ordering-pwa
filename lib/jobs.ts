import { processOutbox } from "@/lib/kitchen/outbox";
import { expireTableVisits } from "@/lib/tables/service";
import { expireInactivePoints } from "@/lib/loyalty/service";

const g = globalThis as unknown as { __jobsStarted?: boolean };

/** In-process background worker: outbox dispatch (the reliability safety net), visit expiry, points expiry. */
export function startBackgroundJobs() {
  if (g.__jobsStarted) return;
  g.__jobsStarted = true;
  const outboxMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 3000);
  const safe = (name: string, fn: () => Promise<unknown>) => () =>
    fn().catch((err) => console.error(`[jobs] ${name} failed:`, err instanceof Error ? err.message : err));

  if (outboxMs > 0) setInterval(safe("outbox", () => processOutbox()), outboxMs).unref?.();
  setInterval(safe("table-visits", () => expireTableVisits()), 5 * 60_000).unref?.();
  setInterval(safe("loyalty-expiry", () => expireInactivePoints()), 60 * 60_000).unref?.();
  console.log(`[jobs] background jobs started (outbox every ${outboxMs}ms)`);
}
