import { z } from "zod";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { prisma } from "@/lib/db/prisma";
import { fullOrderInclude, staffOrderView } from "@/lib/orders/views";
import { outboxHealth } from "@/lib/kitchen/outbox";
import { getRestaurantConfig } from "@/lib/settings";

/**
 * GET /api/v1/supervisor/orders — the approval queue (full detail, oldest first), orders in
 * flight, kitchen flags and dispatch health.
 */
export const GET = staffRoute(
  { permission: PERMISSIONS.ORDER_VIEW, query: z.object({ view: z.enum(["queue", "recent"]).default("queue") }) },
  async ({ staff, query }) => {
    const { settings } = await getRestaurantConfig();
    if (query.view === "recent") {
      const recent = await prisma.order.findMany({
        where: { status: { in: ["SERVED", "REJECTED", "CANCELLED"] }, updatedAt: { gte: new Date(Date.now() - 12 * 3600_000) } },
        include: { table: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      });
      return { recent: recent.map((o) => ({ id: o.id, reference: o.reference, tableLabel: o.table.label, customerName: o.customerName, status: o.status, paymentStatus: o.paymentStatus, totalPaise: o.totalPaise, updatedAt: o.updatedAt })) };
    }
    const [pending, inFlight, flags, outbox] = await Promise.all([
      prisma.order.findMany({
        where: { status: { in: ["PENDING_APPROVAL", "CHANGE_REQUESTED", "CUSTOMER_CONFIRMATION_REQUIRED"] } },
        include: fullOrderInclude,
        orderBy: { submittedAt: "asc" },
        take: 50,
      }),
      prisma.order.findMany({
        where: { status: { in: ["APPROVED", "QUEUED", "PREPARING", "READY", "CANCEL_REQUESTED"] } },
        include: { table: true, kitchenTicket: true },
        orderBy: { approvedAt: "asc" },
        take: 100,
      }),
      prisma.kitchenTicket.findMany({
        where: { flag: { not: "NONE" }, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        orderBy: { flaggedAt: "desc" },
      }),
      outboxHealth(),
    ]);
    const pendingViews = [];
    for (const o of pending) pendingViews.push(await staffOrderView(o, staff.permissions));
    return {
      approvalTargetMinutes: settings.approvalTargetMinutes,
      pending: pendingViews,
      inFlight: inFlight.map((o) => ({
        id: o.id,
        reference: o.reference,
        tableLabel: o.table.label,
        customerName: o.customerName,
        status: o.status,
        paymentStatus: o.paymentStatus,
        approvedAt: o.approvedAt,
        kitchenFlag: o.kitchenTicket?.flag ?? null,
        totalPaise: o.totalPaise,
      })),
      kitchenFlags: flags.map((f) => ({ ticketId: f.id, orderId: f.orderId, orderRef: f.orderRef, tableLabel: f.tableLabel, flag: f.flag, note: f.flagNote, at: f.flaggedAt })),
      outbox,
    };
  },
);
