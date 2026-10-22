// Transactional outbox. Approval writes an OutboxEvent in the same transaction as the status
// change, so an approved order can never be "lost" on the way to the kitchen. The dispatcher
// claims events with FOR UPDATE SKIP LOCKED, runs each handler in its own transaction and
// retries with exponential backoff. Handlers are idempotent (KitchenTicket.orderId is unique).

import { prisma, withTx, type Tx } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { audit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { publish, topics } from "@/lib/notifications/bus";
import { dispatchToKitchen } from "@/lib/kitchen/dispatch";
import { notFound } from "@/lib/http/errors";

export interface OutboxRow {
  id: string;
  type: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
}

export type OutboxHandler = (tx: Tx, event: OutboxRow) => Promise<(() => void) | void>;

const handlers: Record<string, OutboxHandler> = {
  KITCHEN_DISPATCH: dispatchToKitchen,
};

export async function enqueueOutbox(tx: Tx, e: { type: string; aggregateId: string; dedupeKey: string; payload: Prisma.InputJsonValue }) {
  // ON CONFLICT DO NOTHING on dedupeKey: enqueuing the same logical event twice is harmless.
  await tx.outboxEvent.createMany({ data: [e], skipDuplicates: true });
}

// Test hook for simulating dispatch failures (never set in production code paths).
type FaultInjector = (event: OutboxRow) => void;
const g = globalThis as unknown as { __outboxFault?: FaultInjector | null; __outboxRunning?: boolean };
export function setDispatchFaultInjector(fn: FaultInjector | null) {
  g.__outboxFault = fn;
}

export function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 5 * 60_000);
}

export async function processOutbox(opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 20;
  const claimed = await prisma.$queryRaw<OutboxRow[]>`
    UPDATE "OutboxEvent"
       SET status = 'PROCESSING', "lockedAt" = now(), attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM "OutboxEvent"
        WHERE (status = 'PENDING' AND "nextAttemptAt" <= now())
           OR (status = 'PROCESSING' AND "lockedAt" < now() - interval '2 minutes')
        ORDER BY "createdAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING id, type, "aggregateId", payload, attempts, "maxAttempts"`;

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const event of claimed) {
    const handler = handlers[event.type];
    try {
      if (!handler) throw new Error(`No handler for outbox event type ${event.type}`);
      const after = await withTx(async (tx) => {
        g.__outboxFault?.(event);
        const cb = await handler(tx, event);
        await tx.outboxEvent.update({
          where: { id: event.id },
          data: { status: "DONE", processedAt: new Date(), lockedAt: null, lastError: null },
        });
        return cb;
      });
      after?.();
      results.push({ id: event.id, ok: true });
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const exhausted = event.attempts >= event.maxAttempts;
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          lastError: message,
          lockedAt: null,
          nextAttemptAt: new Date(Date.now() + backoffMs(event.attempts)),
        },
      });
      if (exhausted) {
        await prisma.$transaction((tx) =>
          audit(tx, { actor: SYSTEM_ACTOR, action: "outbox.failed", entityType: "OutboxEvent", entityId: event.id, meta: { type: event.type, aggregateId: event.aggregateId, error: message } }),
        );
      }
      publish(topics.staff, "outbox.error", { eventId: event.id, aggregateId: event.aggregateId, exhausted });
      results.push({ id: event.id, ok: false, error: message });
    }
  }
  return results;
}

/** Fire-and-forget dispatch right after a commit; the background worker is the safety net. */
export function kickDispatcher() {
  if (process.env.OUTBOX_AUTO_KICK === "false" || g.__outboxRunning) return;
  g.__outboxRunning = true;
  processOutbox()
    .catch((err) => console.error("[outbox] dispatch error", err instanceof Error ? err.message : err))
    .finally(() => {
      g.__outboxRunning = false;
    });
}

/** Admin/supervisor manual retry of a failed or stuck event. */
export async function retryOutboxEvent(eventId: string, actor: Actor) {
  const event = await prisma.outboxEvent.findUnique({ where: { id: eventId } });
  if (!event) throw notFound("Dispatch event not found");
  if (event.status === "DONE") return event;
  const updated = await prisma.$transaction(async (tx) => {
    const e = await tx.outboxEvent.update({
      where: { id: eventId },
      data: { status: "PENDING", nextAttemptAt: new Date(), lockedAt: null, maxAttempts: Math.max(event.maxAttempts, event.attempts + 3) },
    });
    await audit(tx, { actor, action: "outbox.retry", entityType: "OutboxEvent", entityId: eventId, meta: { aggregateId: event.aggregateId } });
    return e;
  });
  await processOutbox();
  return prisma.outboxEvent.findUnique({ where: { id: updated.id } });
}

export async function outboxHealth() {
  const [pending, failed, stuck] = await Promise.all([
    prisma.outboxEvent.count({ where: { status: "PENDING" } }),
    prisma.outboxEvent.count({ where: { status: "FAILED" } }),
    prisma.outboxEvent.count({ where: { status: "PROCESSING", lockedAt: { lt: new Date(Date.now() - 2 * 60_000) } } }),
  ]);
  return { pending, failed, stuck };
}
