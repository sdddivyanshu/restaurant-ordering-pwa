import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { approveOrder } from "@/lib/approvals/service";
import { processOutbox, retryOutboxEvent, setDispatchFaultInjector } from "@/lib/kitchen/outbox";
import { line, newCustomer, placeOrder, staffLogin } from "../helpers";

afterEach(() => setDispatchFaultInjector(null));

async function approveOnly() {
  const c = await newCustomer("T5");
  const { order } = await placeOrder(c.ctx, [await line("dal-makhani")]);
  const sup = await staffLogin("supervisor");
  await approveOrder(sup.ctx, order.id, 1);
  return order.id;
}

describe("kitchen dispatch reliability", () => {
  it("rolls back a failed dispatch, retries with backoff and creates exactly one ticket", async () => {
    const orderId = await approveOnly();
    let failures = 0;
    setDispatchFaultInjector((e) => {
      if (e.aggregateId === orderId && failures < 2) {
        failures++;
        throw new Error("simulated kitchen printer outage");
      }
    });

    await processOutbox();
    let ev = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: orderId } });
    expect(ev.status).toBe("PENDING");
    expect(ev.attempts).toBe(1);
    expect(ev.lastError).toContain("simulated");
    expect(ev.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // Nothing partially written: no ticket and the order is still APPROVED (not lost, not queued).
    expect(await prisma.kitchenTicket.count({ where: { orderId } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("APPROVED");

    // Make it due now and retry (second simulated failure, then success).
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { nextAttemptAt: new Date() } });
    await processOutbox();
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { nextAttemptAt: new Date() } });
    await processOutbox();

    ev = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect(ev.status).toBe("DONE");
    expect(ev.attempts).toBe(3);
    expect(await prisma.kitchenTicket.count({ where: { orderId } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("QUEUED");
  });

  it("marks exhausted events FAILED (visible to admins) and recovers via manual retry", async () => {
    const orderId = await approveOnly();
    const ev0 = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: orderId } });
    await prisma.outboxEvent.update({ where: { id: ev0.id }, data: { maxAttempts: 2 } });
    setDispatchFaultInjector((e) => {
      if (e.aggregateId === orderId) throw new Error("kitchen service unreachable");
    });
    await processOutbox();
    await prisma.outboxEvent.update({ where: { id: ev0.id }, data: { nextAttemptAt: new Date() } });
    await processOutbox();
    const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev0.id } });
    expect(failed.status).toBe("FAILED");
    expect(await prisma.auditLog.count({ where: { action: "outbox.failed", entityId: ev0.id } })).toBe(1);

    setDispatchFaultInjector(null);
    const admin = await staffLogin("admin");
    const retried = await retryOutboxEvent(ev0.id, { type: "STAFF", id: admin.ctx.userId });
    expect(retried?.status).toBe("DONE");
    expect(await prisma.kitchenTicket.count({ where: { orderId } })).toBe(1);
  });

  it("re-processing a completed or duplicated event never creates a second ticket", async () => {
    const orderId = await approveOnly();
    await processOutbox();
    const ev = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: orderId } });
    // Simulate a duplicate delivery (e.g. worker crashed after commit but before acknowledging).
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: "PENDING", nextAttemptAt: new Date() } });
    await processOutbox();
    expect(await prisma.kitchenTicket.count({ where: { orderId } })).toBe(1);
    // A second event with the same dedupe key cannot even be enqueued.
    const { enqueueOutbox } = await import("@/lib/kitchen/outbox");
    await prisma.$transaction((tx) => enqueueOutbox(tx, { type: "KITCHEN_DISPATCH", aggregateId: orderId, dedupeKey: ev.dedupeKey, payload: { orderId, version: 1 } }));
    expect(await prisma.outboxEvent.count({ where: { aggregateId: orderId } })).toBe(1);
  });

  it("recovers events stuck in PROCESSING after a worker crash", async () => {
    const orderId = await approveOnly();
    const ev = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: orderId } });
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { status: "PROCESSING", lockedAt: new Date(Date.now() - 10 * 60_000) } });
    await processOutbox();
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe("DONE");
    expect(await prisma.kitchenTicket.count({ where: { orderId } })).toBe(1);
  });
});
