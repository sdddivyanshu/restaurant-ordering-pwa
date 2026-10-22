import type { Tx } from "@/lib/db/prisma";
import { lockOrder } from "@/lib/db/locks";
import { transitionOrder } from "@/lib/orders/transition";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { getRestaurantConfig } from "@/lib/settings";
import { publish, publishOrderUpdate, topics } from "@/lib/notifications/bus";
import type { OutboxRow } from "@/lib/kitchen/outbox";

/**
 * KITCHEN_DISPATCH handler. Creates the single kitchen ticket for the *approved* order version
 * and moves APPROVED -> QUEUED in one transaction. Idempotent and safe under retries:
 *  - ticket already exists           -> no-op
 *  - order cancelled/rejected since   -> no-op (nothing reaches the kitchen)
 *  - order never approved             -> no-op
 */
export async function dispatchToKitchen(tx: Tx, event: OutboxRow) {
  const { orderId, version } = event.payload as { orderId: string; version: number };
  await lockOrder(tx, orderId);
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { kitchenTicket: true, table: true, approval: true, items: { where: { version }, include: { customizations: true } } },
  });
  if (!order || order.kitchenTicket) return;
  if (order.status !== "APPROVED") return;
  if (order.approval?.decision !== "APPROVED" || order.approvedVersion !== version) {
    throw new Error(`Refusing dispatch: approved version mismatch for order ${order.reference}`);
  }
  if (order.items.length === 0) throw new Error(`Approved order ${order.reference} has no items for version ${version}`);

  const { settings } = await getRestaurantConfig(tx);
  const maxPrep = order.items.reduce((m, i) => Math.max(m, i.prepMinutes), 0);
  await tx.kitchenTicket.create({
    data: {
      orderId,
      orderVersion: version,
      orderRef: order.reference,
      tableLabel: order.table.label,
      targetMinutes: Math.max(settings.kitchenTargetMinutes, maxPrep),
      notes: order.specialInstructions,
      items: {
        create: order.items.map((i) => ({
          orderItemId: i.id,
          name: i.nameSnapshot,
          quantity: i.quantity,
          modifiers: i.customizations.map((c) => `${c.groupName}: ${c.optionName}`),
          notes: i.notes,
          allergens: i.allergenSnapshot,
          dietType: i.dietType,
          prepMinutes: i.prepMinutes,
        })),
      },
    },
  });
  const updated = await transitionOrder(tx, order, "QUEUED", { actor: SYSTEM_ACTOR, authority: "SYSTEM", note: "Kitchen ticket created" });
  return () => {
    publish(topics.staff, "kitchen.ticket", { orderId });
    publishOrderUpdate({ ...order, status: updated.status });
  };
}
