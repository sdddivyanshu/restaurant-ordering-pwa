// Analytics computed directly from stored records with SQL. Metric definitions are returned with
// every response and documented in docs/analytics.md.

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { getRestaurantConfig } from "@/lib/settings";
import { ACCEPTED_STATUSES } from "@/lib/orders/state-machine";

export const METRIC_DEFINITIONS = {
  orders: "Orders submitted by customers in the date range (by submission time, restaurant timezone).",
  acceptedOrders: "Orders approved by a supervisor and not rejected or cancelled (APPROVED through SERVED, or a pending cancel request).",
  grossSales: "Sum of item prices (including options) of accepted orders, before discounts and excluding tax.",
  discounts: "Loyalty reward discounts applied at ordering plus cashier discount/correction adjustments on accepted orders.",
  refunds: "Refund adjustments recorded against accepted orders.",
  netSales: "Gross sales − discounts − refunds. Excludes tax. Unpaid orders are included (accrual view); see Paid vs unpaid.",
  taxCollected: "Tax on accepted orders as calculated at ordering (not adjusted for post-bill discounts).",
  averageOrderValue: "Net sales ÷ accepted orders.",
  paidVsUnpaid: "Accepted orders grouped by current payment status.",
  rejectedRate: "Rejected orders ÷ submitted orders.",
  cancelledRate: "Cancelled orders ÷ submitted orders.",
  approvalTime: "Average time from submission to supervisor approval.",
  prepTime: "Average time from kitchen start (PREPARING) to READY.",
  readyToServe: "Average time from READY to SERVED.",
  serviceResolution: "Average time from service request creation to completion.",
  demoData: "Seeded sample records are flagged isDemo and can be excluded with the 'Include demo data' toggle.",
};

export interface Range {
  from: string;
  to: string;
  includeDemo: boolean;
}

export function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function getAnalytics(range: Range) {
  const { restaurant } = await getRestaurantConfig();
  const tz = restaurant.timezone;
  // Convert local calendar dates to UTC timestamps comparable with the stored UTC columns.
  const start = Prisma.sql`((${range.from}::date)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'`;
  const end = Prisma.sql`(((${range.to}::date + 1))::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'`;
  const demo = range.includeDemo ? Prisma.sql`TRUE` : Prisma.sql`o."isDemo" = FALSE`;
  const accepted = Prisma.sql`o.status::text = ANY(${ACCEPTED_STATUSES as unknown as string[]})`;
  const inRange = Prisma.sql`o."submittedAt" >= ${start} AND o."submittedAt" < ${end} AND ${demo}`;
  const localDay = (col: Prisma.Sql) => Prisma.sql`((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;

  const [statusRows, salesRow, adjRow, payRows, daily, items, categories, customizations, timings, feedbackRow, feedbackDaily, loyaltyRow, serviceRows, demoRow] =
    await Promise.all([
      prisma.$queryRaw<{ status: string; n: number }[]>`
        SELECT o.status::text AS status, COUNT(*)::float8 AS n FROM "Order" o WHERE ${inRange} GROUP BY o.status`,
      prisma.$queryRaw<{ n: number; gross: number; disc: number; tax: number; total: number }[]>`
        SELECT COUNT(*)::float8 n, COALESCE(SUM(o."subtotalPaise"),0)::float8 gross, COALESCE(SUM(o."discountPaise"),0)::float8 disc,
               COALESCE(SUM(o."taxPaise"),0)::float8 tax, COALESCE(SUM(o."totalPaise"),0)::float8 total
          FROM "Order" o WHERE ${inRange} AND ${accepted}`,
      prisma.$queryRaw<{ disc: number; refund: number }[]>`
        SELECT COALESCE(SUM(a."amountPaise") FILTER (WHERE a.type IN ('DISCOUNT','CORRECTION')),0)::float8 disc,
               COALESCE(SUM(a."amountPaise") FILTER (WHERE a.type = 'REFUND'),0)::float8 refund
          FROM "PaymentAdjustment" a JOIN "Order" o ON o.id = a."orderId" WHERE ${inRange} AND ${accepted}`,
      prisma.$queryRaw<{ status: string; n: number; amount: number }[]>`
        SELECT o."paymentStatus"::text status, COUNT(*)::float8 n, COALESCE(SUM(o."totalPaise"),0)::float8 amount
          FROM "Order" o WHERE ${inRange} AND ${accepted} GROUP BY o."paymentStatus"`,
      prisma.$queryRaw<{ day: Date; orders: number; accepted: number; gross: number; disc: number }[]>`
        SELECT ${localDay(Prisma.sql`o."submittedAt"`)} AS day, COUNT(*)::float8 orders,
               COUNT(*) FILTER (WHERE ${accepted})::float8 accepted,
               COALESCE(SUM(o."subtotalPaise") FILTER (WHERE ${accepted}),0)::float8 gross,
               COALESCE(SUM(o."discountPaise") FILTER (WHERE ${accepted}),0)::float8 disc
          FROM "Order" o WHERE ${inRange} GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ name: string; qty: number; revenue: number }[]>`
        SELECT i."nameSnapshot" name, SUM(i.quantity)::float8 qty, SUM(i."lineSubtotalPaise" - i."lineDiscountPaise")::float8 revenue
          FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId" AND i.version = o.version
         WHERE ${inRange} AND ${accepted} GROUP BY i."menuItemId", i."nameSnapshot" ORDER BY qty DESC, revenue DESC LIMIT 10`,
      prisma.$queryRaw<{ name: string; qty: number; revenue: number }[]>`
        SELECT c.name, SUM(i.quantity)::float8 qty, SUM(i."lineSubtotalPaise" - i."lineDiscountPaise")::float8 revenue
          FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId" AND i.version = o.version
          JOIN "MenuItem" m ON m.id = i."menuItemId" JOIN "MenuCategory" c ON c.id = m."categoryId"
         WHERE ${inRange} AND ${accepted} GROUP BY c.id, c.name ORDER BY revenue DESC`,
      prisma.$queryRaw<{ group_name: string; option_name: string; n: number }[]>`
        SELECT oc."groupName" group_name, oc."optionName" option_name, SUM(i.quantity)::float8 n
          FROM "OrderItemCustomization" oc JOIN "OrderItem" i ON i.id = oc."orderItemId"
          JOIN "Order" o ON o.id = i."orderId" AND i.version = o.version
         WHERE ${inRange} AND ${accepted} GROUP BY 1, 2 ORDER BY n DESC LIMIT 10`,
      prisma.$queryRaw<{ approval: number | null; approval_n: number; prep: number | null; prep_n: number; serve: number | null; serve_n: number }[]>`
        SELECT AVG(EXTRACT(EPOCH FROM (o."approvedAt" - o."submittedAt")))::float8 approval,
               COUNT(o."approvedAt")::float8 approval_n,
               AVG(EXTRACT(EPOCH FROM (o."readyAt" - o."preparingAt"))) FILTER (WHERE o."readyAt" IS NOT NULL AND o."preparingAt" IS NOT NULL)::float8 prep,
               COUNT(*) FILTER (WHERE o."readyAt" IS NOT NULL AND o."preparingAt" IS NOT NULL)::float8 prep_n,
               AVG(EXTRACT(EPOCH FROM (o."servedAt" - o."readyAt"))) FILTER (WHERE o."servedAt" IS NOT NULL AND o."readyAt" IS NOT NULL)::float8 serve,
               COUNT(*) FILTER (WHERE o."servedAt" IS NOT NULL AND o."readyAt" IS NOT NULL)::float8 serve_n
          FROM "Order" o WHERE ${inRange}`,
      prisma.$queryRaw<{ n: number; overall: number | null; food: number | null; service: number | null; complaints: number }[]>`
        SELECT COUNT(*)::float8 n, AVG(f.overall)::float8 overall, AVG(f.food)::float8 food, AVG(f.service)::float8 service,
               COUNT(*) FILTER (WHERE f."isComplaint")::float8 complaints
          FROM "Feedback" f JOIN "Order" o ON o.id = f."orderId" WHERE f."createdAt" >= ${start} AND f."createdAt" < ${end} AND ${demo}`,
      prisma.$queryRaw<{ day: Date; overall: number; n: number }[]>`
        SELECT ${localDay(Prisma.sql`f."createdAt"`)} AS day, AVG(f.overall)::float8 overall, COUNT(*)::float8 n
          FROM "Feedback" f JOIN "Order" o ON o.id = f."orderId" WHERE f."createdAt" >= ${start} AND f."createdAt" < ${end} AND ${demo}
         GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ earned: number; redeemed: number }[]>`
        SELECT COALESCE(SUM(e.points) FILTER (WHERE e.type = 'EARN'),0)::float8 earned,
               COALESCE(-SUM(e.points) FILTER (WHERE e.type = 'REDEEM'),0)::float8 redeemed
          FROM "LoyaltyLedgerEntry" e WHERE e."createdAt" >= ${start} AND e."createdAt" < ${end}`,
      prisma.$queryRaw<{ type: string; n: number; completed: number; avg_resolution: number | null }[]>`
        SELECT s.type::text type, COUNT(*)::float8 n, COUNT(*) FILTER (WHERE s.status = 'COMPLETED')::float8 completed,
               AVG(EXTRACT(EPOCH FROM (s."completedAt" - s."createdAt"))) FILTER (WHERE s.status = 'COMPLETED')::float8 avg_resolution
          FROM "ServiceRequest" s WHERE s."createdAt" >= ${start} AND s."createdAt" < ${end} AND (${range.includeDemo} OR s."isDemo" = FALSE)
         GROUP BY s.type ORDER BY n DESC`,
      prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::float8 n FROM "Order" o WHERE o."submittedAt" >= ${start} AND o."submittedAt" < ${end} AND o."isDemo"`,
    ]);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, num(r.n)]));
  const submitted = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const s = salesRow[0];
  const a = adjRow[0];
  const gross = num(s?.gross);
  const discounts = num(s?.disc) + num(a?.disc);
  const refunds = num(a?.refund);
  const net = gross - discounts - refunds;
  const acceptedCount = num(s?.n);
  const t = timings[0];
  const fb = feedbackRow[0];
  const allServiceN = serviceRows.reduce((x, r) => x + num(r.n), 0);
  const allServiceCompleted = serviceRows.filter((r) => r.avg_resolution != null);

  return {
    range,
    timezone: tz,
    definitions: METRIC_DEFINITIONS,
    demoOrdersInRange: num(demoRow[0]?.n),
    summary: {
      submittedOrders: submitted,
      acceptedOrders: acceptedCount,
      pendingOrders: (byStatus.PENDING_APPROVAL ?? 0) + (byStatus.CHANGE_REQUESTED ?? 0) + (byStatus.CUSTOMER_CONFIRMATION_REQUIRED ?? 0),
      rejectedOrders: byStatus.REJECTED ?? 0,
      cancelledOrders: byStatus.CANCELLED ?? 0,
      grossSalesPaise: gross,
      discountsPaise: discounts,
      refundsPaise: refunds,
      netSalesPaise: net,
      taxPaise: num(s?.tax),
      averageOrderValuePaise: acceptedCount ? Math.round(net / acceptedCount) : 0,
      rejectedRate: submitted ? (byStatus.REJECTED ?? 0) / submitted : 0,
      cancelledRate: submitted ? (byStatus.CANCELLED ?? 0) / submitted : 0,
    },
    byStatus,
    payments: payRows.map((r) => ({ status: r.status, orders: num(r.n), amountPaise: num(r.amount) })),
    daily: daily.map((d) => ({
      day: new Date(d.day).toISOString().slice(0, 10),
      orders: num(d.orders),
      acceptedOrders: num(d.accepted),
      grossSalesPaise: num(d.gross),
      netBeforeAdjustmentsPaise: num(d.gross) - num(d.disc),
    })),
    bestsellers: items.map((i) => ({ name: i.name, quantity: num(i.qty), revenuePaise: num(i.revenue) })),
    categories: categories.map((c) => ({ name: c.name, quantity: num(c.qty), revenuePaise: num(c.revenue) })),
    customizations: customizations.map((c) => ({ group: c.group_name, option: c.option_name, count: num(c.n) })),
    timings: {
      approvalSeconds: t?.approval ?? null,
      approvalSamples: num(t?.approval_n),
      prepSeconds: t?.prep ?? null,
      prepSamples: num(t?.prep_n),
      readyToServeSeconds: t?.serve ?? null,
      readyToServeSamples: num(t?.serve_n),
    },
    feedback: {
      count: num(fb?.n),
      overall: fb?.overall ?? null,
      food: fb?.food ?? null,
      service: fb?.service ?? null,
      complaints: num(fb?.complaints),
      daily: feedbackDaily.map((d) => ({ day: new Date(d.day).toISOString().slice(0, 10), overall: d.overall, count: num(d.n) })),
    },
    loyalty: { pointsEarned: num(loyaltyRow[0]?.earned), pointsRedeemed: num(loyaltyRow[0]?.redeemed) },
    serviceRequests: {
      total: allServiceN,
      byType: serviceRows.map((r) => ({ type: r.type, count: num(r.n), completed: num(r.completed), avgResolutionSeconds: r.avg_resolution })),
      avgResolutionSeconds: allServiceCompleted.length
        ? allServiceCompleted.reduce((x, r) => x + (r.avg_resolution ?? 0) * num(r.completed), 0) / allServiceCompleted.reduce((x, r) => x + num(r.completed), 0)
        : null,
    },
  };
}

// ───────────── CSV export ─────────────

export function csvCell(value: unknown): string {
  let s = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function exportCsv(type: "orders" | "daily" | "items", range: Range) {
  if (type === "orders") {
    const { restaurant } = await getRestaurantConfig();
    const tz = restaurant.timezone;
    const start = Prisma.sql`((${range.from}::date)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'`;
    const end = Prisma.sql`(((${range.to}::date + 1))::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'`;
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT o.reference, o."submittedAt", t.label AS table_label, o.status::text status, o."paymentStatus"::text payment_status,
             o."subtotalPaise", o."discountPaise", o."taxPaise", o."roundingPaise", o."totalPaise", o."isDemo"
        FROM "Order" o JOIN "RestaurantTable" t ON t.id = o."tableId"
       WHERE o."submittedAt" >= ${start} AND o."submittedAt" < ${end} AND (${range.includeDemo} OR o."isDemo" = FALSE)
       ORDER BY o."submittedAt"`;
    return toCsv(
      ["reference", "submitted_at_utc", "table", "status", "payment_status", "subtotal", "discount", "tax", "rounding", "total", "is_demo"],
      rows.map((r) => [
        r.reference,
        r.submittedAt,
        r.table_label,
        r.status,
        r.payment_status,
        num(r.subtotalPaise) / 100,
        num(r.discountPaise) / 100,
        num(r.taxPaise) / 100,
        num(r.roundingPaise) / 100,
        num(r.totalPaise) / 100,
        r.isDemo,
      ]),
    );
  }
  const data = await getAnalytics(range);
  if (type === "daily") {
    return toCsv(
      ["day", "orders", "accepted_orders", "gross_sales", "net_before_adjustments"],
      data.daily.map((d) => [d.day, d.orders, d.acceptedOrders, d.grossSalesPaise / 100, d.netBeforeAdjustmentsPaise / 100]),
    );
  }
  return toCsv(["item", "quantity", "revenue"], data.bestsellers.map((b) => [b.name, b.quantity, b.revenuePaise / 100]));
}
