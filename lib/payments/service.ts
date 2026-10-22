// Cashier operations. Payment collection is independent of approval and kitchen status; every
// write locks the order row so concurrent or repeated recordings cannot over-collect.

import { prisma, withTx, isUniqueViolation, type Tx } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { lockOrder } from "@/lib/db/locks";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import { audit, type Actor } from "@/lib/audit";
import { syncPaymentStatus } from "@/lib/payments/status";
import { summarizeBill } from "@/lib/payments/bill";
import { awardPointsIfEligible, reverseEarnedPoints } from "@/lib/loyalty/service";
import { publish, publishOrderUpdate, topics } from "@/lib/notifications/bus";
import { getRestaurantConfig } from "@/lib/settings";
import { randomCode } from "@/lib/security/tokens";
import { ACCEPTED_STATUSES, type OrderStatusValue } from "@/lib/orders/state-machine";
import type { StaffContext } from "@/lib/auth/staff-session";
import { fullOrderInclude } from "@/lib/orders/views";

const staffActor = (s: StaffContext): Actor => ({ type: "STAFF", id: s.userId, label: s.name });

async function lockedBillState(tx: Tx, orderId: string) {
  if (!(await lockOrder(tx, orderId))) throw notFound("Order not found");
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true, adjustments: true } });
  const bill = summarizeBill({
    totalPaise: order.totalPaise,
    orderCancelled: order.status === "CANCELLED" || order.status === "REJECTED",
    payments: order.payments.map((p) => ({ amountPaise: p.amountPaise, status: p.status })),
    adjustments: order.adjustments.map((a) => ({ type: a.type, amountPaise: a.amountPaise })),
  });
  return { order, bill };
}

export async function ensureReceipt(tx: Tx, orderId: string, issuedById?: string) {
  const existing = await tx.receipt.findUnique({ where: { orderId } });
  if (existing) return existing;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: fullOrderInclude });
  const { restaurant, settings } = await getRestaurantConfig(tx);
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const bill = summarizeBill({
    totalPaise: order.totalPaise,
    orderCancelled: false,
    payments: order.payments.map((p) => ({ amountPaise: p.amountPaise, status: p.status })),
    adjustments: order.adjustments.map((a) => ({ type: a.type, amountPaise: a.amountPaise })),
  });
  const snapshot = {
    restaurant: { name: restaurant.name, legalName: restaurant.legalName, address: restaurant.address, gstin: restaurant.gstin, phone: restaurant.phone },
    order: { reference: order.reference, table: order.table.label, customerName: order.customerName, submittedAt: order.submittedAt, servedAt: order.servedAt },
    items: order.items
      .filter((i) => i.version === order.version)
      .map((i) => ({
        name: i.nameSnapshot,
        quantity: i.quantity,
        options: i.customizations.map((c) => c.optionName),
        unitPricePaise: i.unitPricePaise,
        lineSubtotalPaise: i.lineSubtotalPaise,
        taxRateBps: i.taxRateBps,
      })),
    totals: {
      subtotalPaise: order.subtotalPaise,
      discountPaise: order.discountPaise,
      taxPaise: order.taxPaise,
      roundingPaise: order.roundingPaise,
      totalPaise: order.totalPaise,
      taxBreakdown: order.taxBreakdown,
      pricesIncludeTax: order.pricesIncludeTax,
    },
    bill,
    payments: order.payments.filter((p) => p.status === "RECORDED").map((p) => ({ method: p.method, amountPaise: p.amountPaise, at: p.createdAt, verified: p.providerVerified })),
    adjustments: order.adjustments.map((a) => ({ type: a.type, amountPaise: a.amountPaise, reason: a.reason })),
    footer: settings.receiptFooter,
    currency: restaurant.currency,
  };
  return tx.receipt.create({
    data: { orderId, number: `RCPT-${day}-${randomCode(5)}`, snapshot: snapshot as unknown as Prisma.InputJsonValue, issuedById: issuedById ?? null },
  });
}

export async function recordPayment(
  staff: StaffContext,
  input: { orderId: string; amountPaise: number; method: "CASH" | "UPI_MANUAL" | "CARD_AT_COUNTER" | "OTHER"; externalReference?: string; note?: string; idempotencyKey: string },
) {
  const key = { orderId: input.orderId, idempotencyKey: input.idempotencyKey };
  try {
    const result = await withTx(async (tx) => {
      const { order, bill } = await lockedBillState(tx, input.orderId);
      const existing = await tx.payment.findUnique({ where: { orderId_idempotencyKey: key } });
      if (existing) return { payment: existing, duplicate: true, order };

      if (!ACCEPTED_STATUSES.includes(order.status as OrderStatusValue)) {
        throw conflict("NOT_BILLABLE", "Payments can only be recorded for approved orders.");
      }
      const { settings } = await getRestaurantConfig(tx);
      if (!settings.acceptedPaymentMethods.includes(input.method)) {
        throw unprocessable("METHOD_NOT_ACCEPTED", "This payment method is not enabled in restaurant settings.");
      }
      if (bill.duePaise <= 0) throw conflict("ALREADY_PAID", "This bill is already fully paid.");
      if (input.amountPaise > bill.duePaise) {
        throw unprocessable("OVERPAYMENT", `Amount exceeds the outstanding balance. Record at most ${bill.duePaise / 100}.`, { duePaise: bill.duePaise });
      }
      const payment = await tx.payment.create({
        data: {
          orderId: input.orderId,
          amountPaise: input.amountPaise,
          method: input.method,
          externalReference: input.externalReference || null,
          note: input.note || null,
          idempotencyKey: input.idempotencyKey,
          recordedById: staff.userId,
          provider: "manual",
          providerVerified: false,
        },
      });
      const after = await syncPaymentStatus(tx, input.orderId);
      await audit(tx, {
        actor: staffActor(staff),
        action: "payment.recorded",
        entityType: "Payment",
        entityId: payment.id,
        after: { orderId: input.orderId, amountPaise: input.amountPaise, method: input.method, status: after.status },
      });
      if (after.status === "PAID") {
        await ensureReceipt(tx, input.orderId, staff.userId);
        await awardPointsIfEligible(tx, input.orderId, staffActor(staff));
      }
      return { payment, duplicate: false, order };
    });
    if (!result.duplicate) {
      publish(topics.staff, "payment.recorded", { orderId: input.orderId });
      publishOrderUpdate(result.order);
    }
    return { payment: result.payment, duplicate: result.duplicate };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const payment = await prisma.payment.findUnique({ where: { orderId_idempotencyKey: key } });
      if (payment) return { payment, duplicate: true };
    }
    throw err;
  }
}

export async function voidPayment(staff: StaffContext, paymentId: string, reason: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw notFound("Payment not found");
  const order = await withTx(async (tx) => {
    const { order } = await lockedBillState(tx, payment.orderId);
    const res = await tx.payment.updateMany({
      where: { id: paymentId, status: "RECORDED" },
      data: { status: "VOIDED", voidedAt: new Date(), voidedById: staff.userId, voidReason: reason },
    });
    if (res.count !== 1) throw conflict("ALREADY_VOIDED", "This payment was already voided.");
    await tx.paymentAdjustment.create({
      data: { orderId: payment.orderId, type: "PAYMENT_VOID", amountPaise: payment.amountPaise, reason, paymentId, actorId: staff.userId },
    });
    const bill = await syncPaymentStatus(tx, payment.orderId);
    if (bill.status !== "PAID") await reverseEarnedPoints(tx, payment.orderId, "Payment voided", staffActor(staff));
    await audit(tx, {
      actor: staffActor(staff),
      action: "payment.voided",
      entityType: "Payment",
      entityId: paymentId,
      before: { status: "RECORDED", amountPaise: payment.amountPaise },
      after: { status: "VOIDED" },
      meta: { reason },
    });
    return order;
  });
  publishOrderUpdate(order);
}

export async function addAdjustment(staff: StaffContext, orderId: string, input: { type: "DISCOUNT" | "CORRECTION" | "REFUND"; amountPaise: number; reason: string }) {
  const order = await withTx(async (tx) => {
    const { order, bill } = await lockedBillState(tx, orderId);
    if (input.type === "REFUND") {
      if (input.amountPaise > bill.netPaidPaise) throw unprocessable("REFUND_TOO_LARGE", "Refund exceeds the amount collected.");
    } else {
      if (!ACCEPTED_STATUSES.includes(order.status as OrderStatusValue)) throw conflict("NOT_BILLABLE", "Only approved orders can be discounted.");
      if (input.amountPaise > bill.duePaise) throw unprocessable("ADJUSTMENT_TOO_LARGE", "Adjustment exceeds the outstanding balance. Use a refund for money already collected.");
    }
    const adj = await tx.paymentAdjustment.create({ data: { orderId, type: input.type, amountPaise: input.amountPaise, reason: input.reason, actorId: staff.userId } });
    const after = await syncPaymentStatus(tx, orderId);
    if (input.type === "REFUND") await reverseEarnedPoints(tx, orderId, "Refund issued", staffActor(staff));
    else if (after.status === "PAID") {
      await ensureReceipt(tx, orderId, staff.userId);
      await awardPointsIfEligible(tx, orderId, staffActor(staff));
    }
    await audit(tx, {
      actor: staffActor(staff),
      action: `payment.adjustment.${input.type.toLowerCase()}`,
      entityType: "PaymentAdjustment",
      entityId: adj.id,
      before: { paymentStatus: order.paymentStatus, duePaise: bill.duePaise },
      after: { paymentStatus: after.status, duePaise: after.duePaise, amountPaise: input.amountPaise },
      meta: { reason: input.reason, orderId },
    });
    return order;
  });
  publishOrderUpdate(order);
}

export async function listBills(filter: "outstanding" | "paid" | "all", q?: string) {
  const where: Prisma.OrderWhereInput = {
    status: { in: filter === "outstanding" ? ["APPROVED", "QUEUED", "PREPARING", "READY", "SERVED", "CANCEL_REQUESTED"] : undefined },
    ...(filter === "outstanding" && { paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } }),
    ...(filter === "paid" && { paymentStatus: { in: ["PAID", "REFUNDED"] }, paidAt: { gte: new Date(Date.now() - 24 * 3600_000) } }),
    ...(q && { OR: [{ reference: { contains: q, mode: "insensitive" } }, { table: { label: { equals: q, mode: "insensitive" } } }] }),
  };
  const orders = await prisma.order.findMany({
    where,
    include: { table: true, payments: true, adjustments: true },
    orderBy: filter === "paid" ? { paidAt: "desc" } : { submittedAt: "asc" },
    take: 100,
  });
  return orders.map((o) => {
    const bill = summarizeBill({
      totalPaise: o.totalPaise,
      orderCancelled: o.status === "CANCELLED" || o.status === "REJECTED",
      payments: o.payments.map((p) => ({ amountPaise: p.amountPaise, status: p.status })),
      adjustments: o.adjustments.map((a) => ({ type: a.type, amountPaise: a.amountPaise })),
    });
    return {
      id: o.id,
      reference: o.reference,
      tableLabel: o.table.label,
      customerName: o.customerName,
      status: o.status,
      paymentStatus: o.paymentStatus,
      totalPaise: o.totalPaise,
      duePaise: bill.duePaise,
      paidPaise: bill.netPaidPaise,
      submittedAt: o.submittedAt,
      servedAt: o.servedAt,
      isDemo: o.isDemo,
    };
  });
}
