import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/http/errors";
import { orderVisibilityFilter, type CustomerContext } from "@/lib/auth/customer-session";
import { quoteCart, serializeQuote } from "@/lib/pricing/quote";
import type { CartLineInput } from "@/lib/validation/schemas";

export async function listOrderHistory(customer: CustomerContext, page = 1, pageSize = 20) {
  const where = orderVisibilityFilter(customer);
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { table: true, items: true, feedback: { select: { id: true } } },
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);
  return {
    verified: customer.verified,
    total,
    page,
    rows: rows.map((o) => ({
      id: o.id,
      reference: o.reference,
      submittedAt: o.submittedAt,
      tableLabel: o.table.label,
      status: o.status,
      paymentStatus: o.paymentStatus,
      totalPaise: o.totalPaise,
      items: o.items.filter((i) => i.version === o.version).map((i) => ({ name: i.nameSnapshot, nameI18n: i.nameI18nSnapshot, quantity: i.quantity })),
      feedbackSubmitted: Boolean(o.feedback),
      canReorder: o.status !== "PENDING_APPROVAL",
    })),
  };
}

/** Convert historical order items into fresh cart lines (pure; validation happens in the quote). */
export function buildReorderLines(
  items: { menuItemId: string; quantity: number; notes: string | null; customizations: { groupId: string | null; optionId: string | null }[] }[],
): CartLineInput[] {
  return items.map((i) => {
    const byGroup = new Map<string, string[]>();
    for (const c of i.customizations) {
      if (!c.groupId || !c.optionId) continue;
      byGroup.set(c.groupId, [...(byGroup.get(c.groupId) ?? []), c.optionId]);
    }
    return {
      menuItemId: i.menuItemId,
      quantity: Math.min(i.quantity, 20),
      selections: [...byGroup].map(([groupId, optionIds]) => ({ groupId, optionIds })),
      notes: i.notes ?? undefined,
    };
  });
}

/**
 * Reorder never replays an order into the kitchen: it returns a *new cart* revalidated against
 * today's menu, prices and customization rules. Lines that no longer work are reported.
 */
export async function reorder(customer: CustomerContext, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...orderVisibilityFilter(customer) },
    include: { items: { include: { customizations: true } } },
  });
  if (!order) throw notFound("Order not found");
  const lines = buildReorderLines(order.items.filter((i) => i.version === order.version));
  const quote = await quoteCart(prisma, lines, { customer: { customerId: customer.customerId, verified: customer.verified } });
  const badIndexes = new Set(quote.issues.map((i) => i.index));
  const priceChanged = order.items
    .filter((i) => i.version === order.version)
    .some((old, idx) => {
      const now = quote.lines.find((l) => l.key === String(idx));
      return now && now.unitPricePaise !== old.unitPricePaise;
    });
  return {
    lines: lines.filter((_, idx) => !badIndexes.has(idx)),
    dropped: quote.issues.map((i) => ({ menuItemId: i.menuItemId, name: order.items.find((x) => x.menuItemId === i.menuItemId)?.nameSnapshot ?? "Item", reason: i.message })),
    priceChanged,
    quote: serializeQuote(quote),
  };
}
