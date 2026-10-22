import { prisma, withTx, isUniqueViolation } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import { orderVisibilityFilter, type CustomerContext } from "@/lib/auth/customer-session";
import { audit } from "@/lib/audit";
import type { StaffContext } from "@/lib/auth/staff-session";

export async function submitFeedback(
  customer: CustomerContext,
  input: { orderId: string; overall: number; food: number; service: number; comment?: string; itemRatings: { orderItemId: string; rating: number }[] },
) {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, ...orderVisibilityFilter(customer) },
    include: { items: true, feedback: true },
  });
  if (!order) throw notFound("Order not found");
  if (order.status !== "SERVED") throw unprocessable("NOT_ELIGIBLE", "Feedback opens once your order has been served.");
  if (order.feedback) throw conflict("ALREADY_SUBMITTED", "You have already shared feedback for this order. Thank you!");
  const validItemIds = new Set(order.items.filter((i) => i.version === order.version).map((i) => i.id));
  const itemRatings = input.itemRatings.filter((r) => validItemIds.has(r.orderItemId));
  try {
    return await withTx(async (tx) => {
      const fb = await tx.feedback.create({
        data: {
          orderId: order.id,
          customerId: customer.customerId,
          overall: input.overall,
          food: input.food,
          service: input.service,
          comment: input.comment?.trim() || null,
          itemRatings: itemRatings as unknown as Prisma.InputJsonValue,
          isComplaint: Math.min(input.overall, input.food, input.service) <= 2,
        },
      });
      await audit(tx, { actor: { type: "CUSTOMER", id: customer.customerId }, action: "feedback.submitted", entityType: "Feedback", entityId: fb.id, meta: { orderId: order.id, overall: input.overall } });
      return fb;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("ALREADY_SUBMITTED", "You have already shared feedback for this order. Thank you!");
    throw err;
  }
}

export async function listFeedback(filter: "all" | "complaints" | "unresolved", page: number, pageSize: number) {
  const where: Prisma.FeedbackWhereInput =
    filter === "complaints" ? { isComplaint: true } : filter === "unresolved" ? { status: "NEW", isComplaint: true } : {};
  const [rows, total, agg, unresolvedComplaints] = await Promise.all([
    prisma.feedback.findMany({
      where,
      include: { order: { select: { reference: true, customerName: true, table: { select: { label: true } } } }, responses: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.feedback.count({ where }),
    prisma.feedback.aggregate({ _avg: { overall: true, food: true, service: true }, _count: true }),
    prisma.feedback.count({ where: { isComplaint: true, status: "NEW" } }),
  ]);
  return {
    total,
    page,
    pageSize,
    averages: { overall: agg._avg.overall, food: agg._avg.food, service: agg._avg.service, count: agg._count },
    unresolvedComplaints,
    rows: rows.map((f) => ({
      id: f.id,
      orderReference: f.order.reference,
      tableLabel: f.order.table.label,
      customerName: f.order.customerName,
      overall: f.overall,
      food: f.food,
      service: f.service,
      comment: f.comment,
      isComplaint: f.isComplaint,
      status: f.status,
      isDemo: f.isDemo,
      createdAt: f.createdAt,
      responses: f.responses.map((r) => ({ body: r.body, at: r.createdAt })),
    })),
  };
}

export async function resolveFeedback(staff: StaffContext, id: string, note: string) {
  return withTx(async (tx) => {
    const fb = await tx.feedback.findUnique({ where: { id } });
    if (!fb) throw notFound("Feedback not found");
    await tx.feedbackResponse.create({ data: { feedbackId: id, authorId: staff.userId, body: note } });
    await tx.feedback.update({ where: { id }, data: { status: "RESOLVED", resolvedById: staff.userId, resolvedAt: new Date() } });
    await audit(tx, { actor: { type: "STAFF", id: staff.userId, label: staff.name }, action: "feedback.resolved", entityType: "Feedback", entityId: id });
  });
}
