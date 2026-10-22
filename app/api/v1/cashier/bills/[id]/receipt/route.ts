import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { prisma } from "@/lib/db/prisma";
import { conflict, notFound } from "@/lib/http/errors";
import { ensureReceipt } from "@/lib/payments/service";

/** GET — the immutable receipt snapshot (issued once the bill is fully paid). */
export const GET = staffRoute({ permission: PERMISSIONS.BILL_VIEW }, async ({ staff, params }) => {
  const order = await prisma.order.findUnique({ where: { id: params.id }, select: { id: true, paymentStatus: true } });
  if (!order) throw notFound("Order not found");
  if (order.paymentStatus !== "PAID" && order.paymentStatus !== "REFUNDED") {
    throw conflict("NOT_PAID", "A receipt is issued once the bill is fully paid. Use the bill view for an interim bill.");
  }
  const receipt = await prisma.$transaction((tx) => ensureReceipt(tx, order.id, staff.userId));
  return { receipt };
});
