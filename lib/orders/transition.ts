import type { Tx } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { assertTransition, TransitionError, type OrderStatusValue } from "@/lib/orders/state-machine";
import { ApiError, conflict } from "@/lib/http/errors";
import { audit, type Actor } from "@/lib/audit";

export interface TransitionTarget {
  id: string;
  status: OrderStatusValue;
  lockVersion: number;
  customerId: string;
}

export type ActorAuthority = "CUSTOMER" | "SYSTEM" | ReadonlySet<string>;

const TIMESTAMP_FIELD: Partial<Record<OrderStatusValue, "approvedAt" | "queuedAt" | "preparingAt" | "readyAt" | "servedAt" | "rejectedAt" | "cancelledAt">> = {
  APPROVED: "approvedAt",
  QUEUED: "queuedAt",
  PREPARING: "preparingAt",
  READY: "readyAt",
  SERVED: "servedAt",
  REJECTED: "rejectedAt",
  CANCELLED: "cancelledAt",
};

/**
 * The only function that writes Order.status. It validates the transition against the central
 * state machine, then performs a compare-and-set on (status, lockVersion) so concurrent actors
 * cannot both succeed. Must be called inside a transaction.
 */
export async function transitionOrder<T extends TransitionTarget>(
  tx: Tx,
  order: T,
  to: OrderStatusValue,
  ctx: {
    actor: Actor;
    authority: ActorAuthority;
    note?: string | null;
    data?: Prisma.OrderUpdateManyMutationInput;
    auditMeta?: Record<string, unknown>;
  },
): Promise<T> {
  try {
    assertTransition(order.status, to, ctx.authority);
  } catch (err) {
    if (err instanceof TransitionError) {
      throw new ApiError(err.code === "INVALID_TRANSITION" ? 409 : 403, err.code, err.message);
    }
    throw err;
  }
  const now = new Date();
  const field = TIMESTAMP_FIELD[to];
  // Resuming PREPARING after a declined cancel request keeps the original start time.
  const stamp = field && !(to === "PREPARING" && order.status !== "QUEUED") ? { [field]: now } : {};
  const result = await tx.order.updateMany({
    where: { id: order.id, status: order.status, lockVersion: order.lockVersion },
    data: { ...ctx.data, ...stamp, status: to, lockVersion: { increment: 1 } },
  });
  if (result.count !== 1) {
    throw conflict("CONCURRENT_UPDATE", "This order was just updated by someone else. Refresh and try again.");
  }
  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: to,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id ?? null,
      note: ctx.note ?? null,
    },
  });
  // Customer-facing in-app notification log (service communication, not marketing).
  await tx.notificationEvent.create({
    data: { orderId: order.id, customerId: order.customerId, template: `order.status.${to}`, payload: { from: order.status, to } },
  });
  await audit(tx, {
    actor: ctx.actor,
    action: `order.${to.toLowerCase()}`,
    entityType: "Order",
    entityId: order.id,
    before: { status: order.status },
    after: { status: to },
    meta: { note: ctx.note ?? undefined, ...ctx.auditMeta },
  });
  return { ...order, status: to, lockVersion: order.lockVersion + 1 };
}
