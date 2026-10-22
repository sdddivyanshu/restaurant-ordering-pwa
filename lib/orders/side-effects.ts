import type { Tx } from "@/lib/db/prisma";
import type { Actor } from "@/lib/audit";
import { reverseRedemptionForOrder, reverseEarnedPoints } from "@/lib/loyalty/service";
import { syncPaymentStatus } from "@/lib/payments/status";

/** Shared clean-up when an order ends without being fulfilled (rejected or cancelled). */
export async function onOrderClosedUnfulfilled(tx: Tx, orderId: string, actor: Actor, reason: string) {
  await tx.kitchenTicket.updateMany({
    where: { orderId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    data: { status: "CANCELLED", completedAt: new Date(), lockVersion: { increment: 1 } },
  });
  await reverseRedemptionForOrder(tx, orderId, actor, reason);
  await reverseEarnedPoints(tx, orderId, reason, actor);
  await syncPaymentStatus(tx, orderId);
}
