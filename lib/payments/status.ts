import type { Tx } from "@/lib/db/prisma";
import { summarizeBill } from "@/lib/payments/bill";

/** Recompute Order.paymentStatus from payments + adjustments (the only writer of that field). */
export async function syncPaymentStatus(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true, adjustments: true } });
  const bill = summarizeBill({
    totalPaise: order.totalPaise,
    orderCancelled: order.status === "CANCELLED" || order.status === "REJECTED",
    payments: order.payments.map((p) => ({ amountPaise: p.amountPaise, status: p.status })),
    adjustments: order.adjustments.map((a) => ({ type: a.type, amountPaise: a.amountPaise })),
  });
  if (bill.status !== order.paymentStatus || (bill.status === "PAID" && !order.paidAt)) {
    await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: bill.status, paidAt: bill.status === "PAID" ? order.paidAt ?? new Date() : null },
    });
  }
  return bill;
}
