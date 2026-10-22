import { prisma, withTx } from "@/lib/db/prisma";
import { lockOrder } from "@/lib/db/locks";
import { notFound } from "@/lib/http/errors";
import { transitionOrder } from "@/lib/orders/transition";
import { awardPointsIfEligible } from "@/lib/loyalty/service";
import { publish, publishOrderUpdate, topics } from "@/lib/notifications/bus";
import type { StaffContext } from "@/lib/auth/staff-session";
import type { Actor } from "@/lib/audit";

/** READY -> SERVED by staff holding order.serve. Payment remains a separate concern. */
export async function markServed(staff: StaffContext, orderId: string) {
  const actor: Actor = { type: "STAFF", id: staff.userId, label: staff.name };
  const order = await withTx(async (tx) => {
    if (!(await lockOrder(tx, orderId))) throw notFound("Order not found");
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const updated = await transitionOrder(tx, o, "SERVED", { actor, authority: staff.permissions, data: { servedById: staff.userId } });
    await tx.kitchenTicket.updateMany({ where: { orderId }, data: { status: "COMPLETED", completedAt: new Date(), lockVersion: { increment: 1 } } });
    await awardPointsIfEligible(tx, orderId, actor);
    return updated;
  });
  publish(topics.staff, "kitchen.ticket", { orderId });
  publishOrderUpdate(order);
  return order;
}

/** Orders ready to be carried to tables (no phone numbers — service staff need table + items). */
export async function listReadyToServe() {
  const orders = await prisma.order.findMany({
    where: { status: "READY" },
    include: { table: true, items: true },
    orderBy: { readyAt: "asc" },
  });
  return orders.map((o) => ({
    id: o.id,
    reference: o.reference,
    tableLabel: o.table.label,
    customerName: o.customerName.split(" ")[0],
    readyAt: o.readyAt,
    items: o.items.filter((i) => i.version === o.version).map((i) => ({ name: i.nameSnapshot, quantity: i.quantity })),
  }));
}
