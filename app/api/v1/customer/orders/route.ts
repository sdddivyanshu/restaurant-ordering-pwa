import { NextResponse } from "next/server";
import { customerRoute } from "@/lib/http/route";
import { submitOrderSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { submitOrder } from "@/lib/orders/submit";
import { prisma } from "@/lib/db/prisma";

/** GET — this customer's orders in the current table visit. */
export const GET = customerRoute({}, async ({ customer }) => {
  const orders = await prisma.order.findMany({
    where: { customerSessionId: customer.sessionId },
    orderBy: { submittedAt: "desc" },
    select: { id: true, reference: true, status: true, paymentStatus: true, totalPaise: true, submittedAt: true },
  });
  return { orders };
});

/** POST — submit an order. Always created as PENDING_APPROVAL; duplicate keys return the same order. */
export const POST = customerRoute({ body: submitOrderSchema, rateLimit: RATE_LIMITS.orderCreate }, async ({ customer, body }) => {
  const { order, duplicate } = await submitOrder(customer, body);
  return NextResponse.json(
    { order: { id: order.id, reference: order.reference, status: order.status, totalPaise: order.totalPaise }, duplicate },
    { status: duplicate ? 200 : 201 },
  );
});
