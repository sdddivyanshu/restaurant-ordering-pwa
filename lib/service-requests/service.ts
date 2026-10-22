import { prisma, withTx } from "@/lib/db/prisma";
import type { Priority, ServiceRequestStatus, ServiceRequestType } from "@/lib/generated/prisma/client";
import { conflict, notFound } from "@/lib/http/errors";
import { getRestaurantConfig } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { publish, topics } from "@/lib/notifications/bus";
import type { CustomerContext } from "@/lib/auth/customer-session";
import type { StaffContext } from "@/lib/auth/staff-session";

export const REQUEST_PRIORITY: Record<ServiceRequestType, Priority> = {
  WAITER: "NORMAL",
  WATER: "LOW",
  CUTLERY: "LOW",
  BILL: "NORMAL",
  TAKEAWAY_PACKAGING: "LOW",
  ASSISTANCE: "HIGH",
  CUSTOM: "NORMAL",
};

const OPEN: ServiceRequestStatus[] = ["PENDING", "ACKNOWLEDGED", "IN_PROGRESS"];

/**
 * Create a table-side request. Repeated taps within the suppression window return the existing
 * open request instead of flooding the staff queue. An advisory lock per (visit, type) makes
 * the duplicate check race-free.
 */
export async function createServiceRequest(customer: CustomerContext, input: { type: ServiceRequestType; message?: string }) {
  const { settings } = await getRestaurantConfig();
  const result = await withTx(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${customer.tableSessionId}:${input.type}`}))`;
    const since = new Date(Date.now() - settings.serviceDupWindowSeconds * 1000);
    const existing = await tx.serviceRequest.findFirst({
      where: {
        tableSessionId: customer.tableSessionId,
        type: input.type,
        status: { in: OPEN },
        createdAt: { gte: since },
        ...(input.type === "CUSTOM" && { message: input.message ?? null }),
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return { request: existing, duplicate: true };
    const request = await tx.serviceRequest.create({
      data: {
        tableId: customer.tableId,
        tableSessionId: customer.tableSessionId,
        customerSessionId: customer.sessionId,
        type: input.type,
        message: input.type === "CUSTOM" ? input.message?.slice(0, 140) ?? null : null,
        priority: REQUEST_PRIORITY[input.type],
      },
    });
    return { request, duplicate: false };
  });
  if (!result.duplicate) publish(topics.staff, "service.request", { id: result.request.id, table: customer.tableLabel });
  return result;
}

export async function listCustomerRequests(customer: CustomerContext) {
  const rows = await prisma.serviceRequest.findMany({
    where: { tableSessionId: customer.tableSessionId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    message: r.message,
    status: r.status,
    createdAt: r.createdAt,
    canCancel: r.status === "PENDING" && r.customerSessionId === customer.sessionId,
  }));
}

export async function cancelRequestByCustomer(customer: CustomerContext, id: string) {
  const res = await prisma.serviceRequest.updateMany({
    where: { id, customerSessionId: customer.sessionId, status: "PENDING" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (res.count !== 1) throw notFound("Request not found or already being handled");
  publish(topics.staff, "service.request", { id });
}

export async function listStaffRequests() {
  const recent = new Date(Date.now() - 60 * 60_000);
  const rows = await prisma.serviceRequest.findMany({
    where: { OR: [{ status: { in: OPEN } }, { updatedAt: { gte: recent } }] },
    include: { table: true },
    orderBy: [{ createdAt: "asc" }],
    take: 200,
  });
  const userIds = [...new Set(rows.map((r) => r.assignedToId).filter(Boolean))] as string[];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const rank: Record<Priority, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };
  return rows
    .map((r) => ({
      id: r.id,
      tableLabel: r.table.label,
      type: r.type,
      message: r.message,
      priority: r.priority,
      status: r.status,
      assignedTo: users.find((u) => u.id === r.assignedToId)?.name ?? null,
      createdAt: r.createdAt,
      acknowledgedAt: r.acknowledgedAt,
      completedAt: r.completedAt,
      ageSeconds: Math.round((Date.now() - r.createdAt.getTime()) / 1000),
    }))
    .sort((a, b) => Number(!OPEN.includes(a.status)) - Number(!OPEN.includes(b.status)) || rank[a.priority] - rank[b.priority] || +a.createdAt - +b.createdAt);
}

const ACTIONS: Record<"acknowledge" | "start" | "complete" | "cancel", { from: ServiceRequestStatus[]; to: ServiceRequestStatus }> = {
  acknowledge: { from: ["PENDING"], to: "ACKNOWLEDGED" },
  start: { from: ["PENDING", "ACKNOWLEDGED"], to: "IN_PROGRESS" },
  complete: { from: ["PENDING", "ACKNOWLEDGED", "IN_PROGRESS"], to: "COMPLETED" },
  cancel: { from: ["PENDING", "ACKNOWLEDGED", "IN_PROGRESS"], to: "CANCELLED" },
};

export async function staffRequestAction(staff: StaffContext, id: string, action: keyof typeof ACTIONS) {
  const rule = ACTIONS[action];
  const now = new Date();
  const result = await withTx(async (tx) => {
    const res = await tx.serviceRequest.updateMany({
      where: { id, status: { in: rule.from } },
      data: {
        status: rule.to,
        ...(action === "acknowledge" || action === "start" ? { assignedToId: staff.userId } : {}),
        ...(action === "acknowledge" && { acknowledgedAt: now }),
        ...(action === "complete" && { completedAt: now }),
        ...(action === "cancel" && { cancelledAt: now }),
      },
    });
    if (res.count !== 1) {
      const exists = await tx.serviceRequest.findUnique({ where: { id }, select: { status: true } });
      if (!exists) throw notFound("Request not found");
      throw conflict("INVALID_STATE", `Request is already ${exists.status.toLowerCase().replace("_", " ")}`);
    }
    await audit(tx, { actor: { type: "STAFF", id: staff.userId, label: staff.name }, action: `service_request.${action}`, entityType: "ServiceRequest", entityId: id });
    return tx.serviceRequest.findUniqueOrThrow({ where: { id } });
  });
  publish(topics.staff, "service.request", { id });
  publish(topics.tableSession(result.tableSessionId), "service.updated", { id });
  if (result.customerSessionId) publish(topics.customerSession(result.customerSessionId), "service.updated", { id });
  return result;
}
