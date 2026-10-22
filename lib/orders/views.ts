// Role-specific order projections. Each view returns only what that audience needs:
// customers never see staff identities or internal notes; the kitchen never sees customer
// names or phone numbers; full phone numbers require the customer.pii.view permission.

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { summarizeBill } from "@/lib/payments/bill";
import { maskPhone } from "@/lib/security/phone";
import { hasPermission, PERMISSIONS } from "@/lib/authorization/permissions";
import { unavailableReason } from "@/lib/menu/availability";

export const fullOrderInclude = {
  items: { include: { customizations: true }, orderBy: { id: "asc" } },
  history: { orderBy: { createdAt: "asc" } },
  approval: true,
  changeRequests: { orderBy: { createdAt: "desc" } },
  notes: { orderBy: { createdAt: "asc" } },
  kitchenTicket: true,
  payments: { orderBy: { createdAt: "asc" } },
  adjustments: { orderBy: { createdAt: "asc" } },
  receipt: true,
  feedback: true,
  redemption: { include: { reward: true } },
  table: true,
  customer: true,
} satisfies Prisma.OrderInclude;

export type FullOrder = Prisma.OrderGetPayload<{ include: typeof fullOrderInclude }>;

export function currentItems(order: FullOrder) {
  return order.items.filter((i) => i.version === order.version);
}

export function billFor(order: Pick<FullOrder, "totalPaise" | "status" | "payments" | "adjustments">) {
  return summarizeBill({
    totalPaise: order.totalPaise,
    orderCancelled: order.status === "CANCELLED" || order.status === "REJECTED",
    payments: order.payments.map((p) => ({ amountPaise: p.amountPaise, status: p.status })),
    adjustments: order.adjustments.map((a) => ({ type: a.type, amountPaise: a.amountPaise })),
  });
}

function itemView(i: FullOrder["items"][number]) {
  return {
    id: i.id,
    menuItemId: i.menuItemId,
    name: i.nameSnapshot,
    nameI18n: i.nameI18nSnapshot as Record<string, string>,
    quantity: i.quantity,
    dietType: i.dietType,
    allergens: i.allergenSnapshot,
    notes: i.notes,
    unitPricePaise: i.unitPricePaise,
    lineSubtotalPaise: i.lineSubtotalPaise,
    lineDiscountPaise: i.lineDiscountPaise,
    lineTaxPaise: i.lineTaxPaise,
    lineTotalPaise: i.lineTotalPaise,
    taxRateBps: i.taxRateBps,
    options: i.customizations.map((c) => ({ groupId: c.groupId, optionId: c.optionId, groupName: c.groupName, optionName: c.optionName, priceDeltaPaise: c.priceDeltaPaise })),
  };
}

function totalsView(order: FullOrder) {
  return {
    subtotalPaise: order.subtotalPaise,
    discountPaise: order.discountPaise,
    taxPaise: order.taxPaise,
    roundingPaise: order.roundingPaise,
    totalPaise: order.totalPaise,
    taxBreakdown: order.taxBreakdown,
    pricesIncludeTax: order.pricesIncludeTax,
    currency: order.currency,
  };
}

export function customerOrderView(order: FullOrder) {
  const pendingChange = order.changeRequests.find((c) => c.status === "PROPOSED" && c.fromVersion === order.version);
  const bill = billFor(order);
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    paymentStatus: order.paymentStatus,
    tableLabel: order.table.label,
    tableName: order.table.name,
    customerName: order.customerName,
    version: order.version,
    submittedAt: order.submittedAt,
    approvedAt: order.approvedAt,
    preparingAt: order.preparingAt,
    readyAt: order.readyAt,
    servedAt: order.servedAt,
    specialInstructions: order.specialInstructions,
    rejectionReason: order.rejectionReason,
    cancelReason: order.cancelReason,
    clarificationNote: order.status === "CHANGE_REQUESTED" ? order.clarificationNote : null,
    items: currentItems(order).map(itemView),
    ...totalsView(order),
    reward: order.redemption && order.redemption.status === "APPLIED"
      ? { name: order.redemption.reward.name, pointsSpent: order.redemption.pointsSpent, discountPaise: order.redemption.discountPaise }
      : null,
    changeRequest: pendingChange
      ? { id: pendingChange.id, kind: pendingChange.kind, reason: pendingChange.reason, quote: pendingChange.proposedQuote, createdAt: pendingChange.createdAt }
      : null,
    timeline: order.history.map((h) => ({ status: h.toStatus, at: h.createdAt })),
    bill,
    payments: order.payments
      .filter((p) => p.status === "RECORDED")
      .map((p) => ({ amountPaise: p.amountPaise, method: p.method, at: p.createdAt, providerVerified: p.providerVerified })),
    receiptNumber: order.receipt?.number ?? null,
    estimatedReadyAt:
      order.kitchenTicket && ["QUEUED", "PREPARING"].includes(order.status)
        ? new Date((order.preparingAt ?? order.queuedAt ?? order.createdAt).getTime() + order.kitchenTicket.targetMinutes * 60_000)
        : null,
    feedbackSubmitted: Boolean(order.feedback),
    canCancel: order.status === "PENDING_APPROVAL",
    canGiveFeedback: order.status === "SERVED" && !order.feedback,
  };
}

export type CustomerOrderView = ReturnType<typeof customerOrderView>;

export async function staffOrderView(order: FullOrder, permissions: ReadonlySet<string>) {
  const canSeePii = hasPermission(permissions, PERMISSIONS.CUSTOMER_PII_VIEW);
  const actorIds = new Set<string>();
  order.history.forEach((h) => h.actorType === "STAFF" && h.actorId && actorIds.add(h.actorId));
  order.notes.forEach((n) => actorIds.add(n.authorId));
  order.payments.forEach((p) => actorIds.add(p.recordedById));
  order.adjustments.forEach((a) => actorIds.add(a.actorId));
  const users = await prisma.user.findMany({ where: { id: { in: [...actorIds] } }, select: { id: true, name: true } });
  const nameOf = (id?: string | null) => (id ? users.find((u) => u.id === id)?.name ?? "Staff" : null);

  const items = currentItems(order);
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: items.map((i) => i.menuItemId) } },
    include: { category: true, customizationGroups: { include: { group: { include: { options: true } } } } },
  });
  const restaurant = await prisma.restaurant.findFirst({ select: { timezone: true } });
  const now = new Date();
  const availability = new Map(menuItems.map((m) => [m.id, unavailableReason(m, now, restaurant?.timezone ?? "Asia/Kolkata")]));
  const optionAvailability = new Map(menuItems.flatMap((m) => m.customizationGroups.flatMap((g) => g.group.options.map((o) => [o.id, o.isAvailable && !o.archivedAt] as const))));

  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    paymentStatus: order.paymentStatus,
    version: order.version,
    lockVersion: order.lockVersion,
    tableLabel: order.table.label,
    tableName: order.table.name,
    customerName: order.customerName,
    customerPhone: canSeePii ? order.customer.phoneE164 : maskPhone(order.customer.phoneE164),
    customerVerified: Boolean(order.customer.verifiedAt),
    submittedAt: order.submittedAt,
    approvedAt: order.approvedAt,
    approvedBy: nameOf(order.approvedById),
    queuedAt: order.queuedAt,
    preparingAt: order.preparingAt,
    readyAt: order.readyAt,
    servedAt: order.servedAt,
    waitingSeconds: Math.round((now.getTime() - order.submittedAt.getTime()) / 1000),
    specialInstructions: order.specialInstructions,
    needsClarification: order.needsClarification,
    clarificationNote: order.clarificationNote,
    rejectionReason: order.rejectionReason,
    cancelReason: order.cancelReason,
    items: items.map((i) => ({
      ...itemView(i),
      availableNow: availability.get(i.menuItemId) == null && i.customizations.every((c) => !c.optionId || optionAvailability.get(c.optionId) !== false),
      unavailableReason: availability.get(i.menuItemId) ?? null,
    })),
    ...totalsView(order),
    reward: order.redemption ? { name: order.redemption.reward.name, pointsSpent: order.redemption.pointsSpent, status: order.redemption.status } : null,
    history: order.history.map((h) => ({ from: h.fromStatus, to: h.toStatus, at: h.createdAt, actorType: h.actorType, actor: h.actorType === "STAFF" ? nameOf(h.actorId) : h.actorType === "CUSTOMER" ? "Customer" : "System", note: h.note })),
    notes: order.notes.map((n) => ({ id: n.id, body: n.body, author: nameOf(n.authorId), at: n.createdAt })),
    changeRequests: order.changeRequests.map((c) => ({ id: c.id, kind: c.kind, reason: c.reason, status: c.status, fromVersion: c.fromVersion, createdAt: c.createdAt, respondedAt: c.respondedAt, quote: c.proposedQuote })),
    kitchen: order.kitchenTicket
      ? { status: order.kitchenTicket.status, flag: order.kitchenTicket.flag, flagNote: order.kitchenTicket.flagNote, targetMinutes: order.kitchenTicket.targetMinutes }
      : null,
    bill: billFor(order),
    payments: order.payments.map((p) => ({ id: p.id, amountPaise: p.amountPaise, method: p.method, status: p.status, externalReference: p.externalReference, providerVerified: p.providerVerified, recordedBy: nameOf(p.recordedById), at: p.createdAt, voidReason: p.voidReason })),
    adjustments: order.adjustments.map((a) => ({ id: a.id, type: a.type, amountPaise: a.amountPaise, reason: a.reason, by: nameOf(a.actorId), at: a.createdAt })),
    receiptNumber: order.receipt?.number ?? null,
    isDemo: order.isDemo,
  };
}

export type StaffOrderView = Awaited<ReturnType<typeof staffOrderView>>;

export async function loadFullOrder(where: Prisma.OrderWhereInput): Promise<FullOrder | null> {
  return prisma.order.findFirst({ where, include: fullOrderInclude });
}
