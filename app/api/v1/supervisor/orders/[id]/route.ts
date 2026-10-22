import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS, hasPermission } from "@/lib/authorization/permissions";
import { supervisorActionSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { forbidden, notFound } from "@/lib/http/errors";
import { fullOrderInclude, staffOrderView } from "@/lib/orders/views";
import { prisma } from "@/lib/db/prisma";
import {
  addOrderNote,
  approveOrder,
  cancelOrderByStaff,
  flagOrder,
  proposeChange,
  rejectOrder,
  resolveFlag,
  withdrawChange,
} from "@/lib/approvals/service";

export const GET = staffRoute({ permission: [PERMISSIONS.ORDER_VIEW, PERMISSIONS.BILL_VIEW] }, async ({ staff, params }) => {
  const order = await prisma.order.findUnique({ where: { id: params.id }, include: fullOrderInclude });
  if (!order) throw notFound("Order not found");
  return { order: await staffOrderView(order, staff.permissions) };
});

// Each action re-checks its specific permission; the transition service checks it again.
const ACTION_PERMISSION = {
  approve: PERMISSIONS.ORDER_APPROVE,
  reject: PERMISSIONS.ORDER_APPROVE,
  flag: PERMISSIONS.ORDER_CHANGE,
  "resolve-flag": PERMISSIONS.ORDER_CHANGE,
  "propose-change": PERMISSIONS.ORDER_CHANGE,
  "withdraw-change": PERMISSIONS.ORDER_CHANGE,
  note: PERMISSIONS.ORDER_VIEW,
  cancel: PERMISSIONS.ORDER_CANCEL,
} as const;

/** POST — supervisor actions: approve | reject | flag | resolve-flag | propose-change | withdraw-change | note | cancel */
export const POST = staffRoute(
  {
    permission: [PERMISSIONS.ORDER_APPROVE, PERMISSIONS.ORDER_CHANGE, PERMISSIONS.ORDER_CANCEL, PERMISSIONS.ORDER_VIEW],
    body: supervisorActionSchema,
    rateLimit: RATE_LIMITS.staffWrite,
  },
  async ({ staff, params, body }) => {
    if (!hasPermission(staff.permissions, ACTION_PERMISSION[body.action])) throw forbidden();
    const id = params.id;
    switch (body.action) {
      case "approve": {
        const r = await approveOrder(staff, id, body.expectedVersion);
        return { status: r.order.status, alreadyApproved: r.alreadyApproved };
      }
      case "reject":
        return { status: (await rejectOrder(staff, id, body.reason)).status };
      case "flag":
        return { status: (await flagOrder(staff, id, body.note)).status };
      case "resolve-flag":
        return { status: (await resolveFlag(staff, id, body.note)).status };
      case "propose-change":
        return { status: (await proposeChange(staff, id, body)).status };
      case "withdraw-change":
        return { status: (await withdrawChange(staff, id)).status };
      case "note":
        return { note: await addOrderNote(staff, id, body.body) };
      case "cancel":
        return { status: (await cancelOrderByStaff(staff, id, body.reason)).status };
    }
  },
);
