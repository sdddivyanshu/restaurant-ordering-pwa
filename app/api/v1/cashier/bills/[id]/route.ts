import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/http/errors";
import { fullOrderInclude, staffOrderView } from "@/lib/orders/views";

export const GET = staffRoute({ permission: PERMISSIONS.BILL_VIEW }, async ({ staff, params }) => {
  const order = await prisma.order.findUnique({ where: { id: params.id }, include: fullOrderInclude });
  if (!order) throw notFound("Bill not found");
  return { order: await staffOrderView(order, staff.permissions) };
});
