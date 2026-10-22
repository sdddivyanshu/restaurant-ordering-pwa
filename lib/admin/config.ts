import { prisma, withTx } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { notFound } from "@/lib/http/errors";
import { audit, type Actor } from "@/lib/audit";
import { getRestaurantConfig } from "@/lib/settings";
import type { z } from "zod";
import type { rewardUpsertSchema, settingsUpdateSchema, taxUpsertSchema } from "@/lib/validation/schemas";
import { outboxHealth } from "@/lib/kitchen/outbox";

export async function getSettingsForAdmin() {
  const { restaurant, settings } = await getRestaurantConfig();
  const taxes = await prisma.taxConfiguration.findMany({ orderBy: { rateBps: "asc" } });
  return { restaurant, settings, taxes };
}

export async function updateSettings(input: z.infer<typeof settingsUpdateSchema>, actor: Actor) {
  const { restaurant, settings } = await getRestaurantConfig();
  return withTx(async (tx) => {
    if (input.restaurant) await tx.restaurant.update({ where: { id: restaurant.id }, data: input.restaurant });
    if (input.settings) await tx.restaurantSettings.update({ where: { id: settings.id }, data: { ...input.settings, updatedById: actor.id ?? null } });
    await audit(tx, { actor, action: "settings.updated", entityType: "RestaurantSettings", entityId: settings.id, before: { restaurant, settings }, after: input });
  });
}

export async function saveTax(id: string | null, input: z.infer<typeof taxUpsertSchema>, actor: Actor) {
  const { restaurant } = await getRestaurantConfig();
  return withTx(async (tx) => {
    if (input.isDefault) await tx.taxConfiguration.updateMany({ data: { isDefault: false } });
    const data = { ...input, components: input.components as unknown as Prisma.InputJsonValue };
    const tax = id
      ? await tx.taxConfiguration.update({ where: { id }, data })
      : await tx.taxConfiguration.create({ data: { ...data, restaurantId: restaurant.id } });
    await audit(tx, { actor, action: id ? "tax.updated" : "tax.created", entityType: "TaxConfiguration", entityId: tax.id, after: input });
    return tax;
  });
}

export async function listRewards() {
  return prisma.reward.findMany({ orderBy: [{ displayOrder: "asc" }, { pointsCost: "asc" }], include: { _count: { select: { redemptions: true } } } });
}

export async function saveReward(id: string | null, input: z.infer<typeof rewardUpsertSchema>, actor: Actor) {
  return withTx(async (tx) => {
    const before = id ? await tx.reward.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound("Reward not found");
    const reward = id ? await tx.reward.update({ where: { id }, data: input }) : await tx.reward.create({ data: input });
    await audit(tx, { actor, action: id ? "reward.updated" : "reward.created", entityType: "Reward", entityId: reward.id, before, after: input });
    return reward;
  });
}

export async function searchOrders(params: { q?: string; status?: string; page: number; pageSize: number }) {
  const where: Prisma.OrderWhereInput = {
    ...(params.status && { status: params.status as Prisma.OrderWhereInput["status"] }),
    ...(params.q && {
      OR: [
        { reference: { contains: params.q, mode: "insensitive" } },
        { customerName: { contains: params.q, mode: "insensitive" } },
        { table: { label: { equals: params.q, mode: "insensitive" } } },
      ],
    }),
  };
  const [rows, total] = await Promise.all([
    prisma.order.findMany({ where, include: { table: true }, orderBy: { submittedAt: "desc" }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
    prisma.order.count({ where }),
  ]);
  return {
    total,
    page: params.page,
    pageSize: params.pageSize,
    rows: rows.map((o) => ({
      id: o.id,
      reference: o.reference,
      tableLabel: o.table.label,
      customerName: o.customerName,
      status: o.status,
      paymentStatus: o.paymentStatus,
      totalPaise: o.totalPaise,
      submittedAt: o.submittedAt,
      isDemo: o.isDemo,
    })),
  };
}

export async function listAudit(params: { q?: string; page: number; pageSize: number }) {
  const where: Prisma.AuditLogWhereInput = params.q
    ? { OR: [{ action: { contains: params.q, mode: "insensitive" } }, { entityType: { contains: params.q, mode: "insensitive" } }, { entityId: params.q }] }
    : {};
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  const ids = [...new Set(rows.filter((r) => r.actorType === "STAFF" && r.actorId).map((r) => r.actorId!))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return {
    total,
    page: params.page,
    pageSize: params.pageSize,
    rows: rows.map((r) => ({
      ...r,
      actorName: r.actorType === "STAFF" ? users.find((u) => u.id === r.actorId)?.name ?? r.actorLabel : r.actorType === "CUSTOMER" ? "Customer" : "System",
    })),
  };
}

export async function listOutbox(status?: string) {
  const rows = await prisma.outboxEvent.findMany({
    where: status ? { status: status as Prisma.OutboxEventWhereInput["status"] } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const orders = await prisma.order.findMany({ where: { id: { in: rows.map((r) => r.aggregateId) } }, select: { id: true, reference: true, status: true } });
  return {
    health: await outboxHealth(),
    rows: rows.map((r) => ({ ...r, order: orders.find((o) => o.id === r.aggregateId) ?? null })),
  };
}

export async function adminOverview() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [pending, active, ready, unpaid, todayOrders, todaySales, openRequests, complaints, outbox, tables] = await Promise.all([
    prisma.order.count({ where: { status: { in: ["PENDING_APPROVAL", "CHANGE_REQUESTED", "CUSTOMER_CONFIRMATION_REQUIRED"] } } }),
    prisma.order.count({ where: { status: { in: ["APPROVED", "QUEUED", "PREPARING"] } } }),
    prisma.order.count({ where: { status: "READY" } }),
    prisma.order.count({ where: { status: { in: ["SERVED", "READY", "PREPARING", "QUEUED", "APPROVED"] }, paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } } }),
    prisma.order.count({ where: { submittedAt: { gte: startOfDay } } }),
    prisma.order.aggregate({
      where: { submittedAt: { gte: startOfDay }, status: { in: ["APPROVED", "QUEUED", "PREPARING", "READY", "SERVED", "CANCEL_REQUESTED"] } },
      _sum: { subtotalPaise: true, discountPaise: true },
    }),
    prisma.serviceRequest.count({ where: { status: { in: ["PENDING", "ACKNOWLEDGED", "IN_PROGRESS"] } } }),
    prisma.feedback.count({ where: { isComplaint: true, status: "NEW" } }),
    outboxHealth(),
    prisma.restaurantTable.groupBy({ by: ["status"], where: { archivedAt: null }, _count: true }),
  ]);
  return {
    pendingApprovals: pending,
    inKitchen: active,
    readyToServe: ready,
    unpaidBills: unpaid,
    todayOrders,
    todayNetSalesPaise: (todaySales._sum.subtotalPaise ?? 0) - (todaySales._sum.discountPaise ?? 0),
    openServiceRequests: openRequests,
    unresolvedComplaints: complaints,
    outbox,
    tables: Object.fromEntries(tables.map((t) => [t.status, t._count])),
  };
}
