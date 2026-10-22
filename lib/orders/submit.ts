import { prisma, withTx, isUniqueViolation, type Tx } from "@/lib/db/prisma";
import type { CustomerContext } from "@/lib/auth/customer-session";
import { quoteCart, serializeQuote } from "@/lib/pricing/quote";
import { conflict, unprocessable } from "@/lib/http/errors";
import { randomCode } from "@/lib/security/tokens";
import { audit } from "@/lib/audit";
import { publishOrderUpdate } from "@/lib/notifications/bus";
import { createOrderItemsFromQuote, totalsFromQuote } from "@/lib/orders/create-items";
import { redeemRewardForOrder } from "@/lib/loyalty/service";
import type { CartLineInput } from "@/lib/validation/schemas";

export interface SubmitOrderInput {
  lines: CartLineInput[];
  rewardId?: string | null;
  specialInstructions?: string;
  expectedTotalPaise: number;
  idempotencyKey: string;
}

async function uniqueReference(tx: Tx): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const ref = `ORD-${randomCode(6)}`;
    if (!(await tx.order.findUnique({ where: { reference: ref }, select: { id: true } }))) return ref;
  }
  throw new Error("Could not allocate an order reference");
}

/**
 * Customer order submission. Re-prices everything on the server, rejects stale totals,
 * and creates the order + items + history atomically in PENDING_APPROVAL. The idempotency key
 * (unique per customer session) makes retries after timeouts return the same order.
 */
export async function submitOrder(customer: CustomerContext, input: SubmitOrderInput) {
  const key = { customerSessionId: customer.sessionId, idempotencyKey: input.idempotencyKey };
  const existing = await prisma.order.findUnique({ where: { customerSessionId_idempotencyKey: key } });
  if (existing) return { order: existing, duplicate: true };

  try {
    const order = await withTx(async (tx) => {
      const quote = await quoteCart(tx, input.lines, {
        rewardId: input.rewardId,
        customer: { customerId: customer.customerId, verified: customer.verified },
      });
      if (quote.issues.length) {
        throw conflict("CART_INVALID", "Some items in your cart are unavailable or need changes.", { quote: serializeQuote(quote) });
      }
      if (input.rewardId && quote.rewardError) {
        throw unprocessable("REWARD_INVALID", quote.rewardError.message, { quote: serializeQuote(quote) });
      }
      if (quote.lines.length === 0) throw unprocessable("CART_EMPTY", "Your cart is empty");
      if (quote.totalPaise !== input.expectedTotalPaise) {
        throw conflict("PRICE_CHANGED", "Prices or availability changed since you reviewed your cart. Please confirm the updated total.", {
          quote: serializeQuote(quote),
        });
      }

      const session = await tx.customerSession.findUniqueOrThrow({ where: { id: customer.sessionId }, select: { deviceId: true, language: true } });
      const created = await tx.order.create({
        data: {
          reference: await uniqueReference(tx),
          customerId: customer.customerId,
          customerSessionId: customer.sessionId,
          deviceId: session.deviceId,
          tableSessionId: customer.tableSessionId,
          tableId: customer.tableId,
          customerName: customer.customerName,
          status: "PENDING_APPROVAL",
          version: 1,
          ...totalsFromQuote(quote),
          currency: quote.currency,
          specialInstructions: input.specialInstructions?.trim() || null,
          language: session.language,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await createOrderItemsFromQuote(tx, created.id, 1, quote);
      await tx.orderStatusHistory.create({
        data: { orderId: created.id, fromStatus: null, toStatus: "PENDING_APPROVAL", actorType: "CUSTOMER", actorId: customer.customerId },
      });
      if (quote.reward) {
        await redeemRewardForOrder(tx, {
          customerId: customer.customerId,
          rewardId: quote.reward.id,
          orderId: created.id,
          pointsCost: quote.reward.pointsCost,
          discountPaise: quote.discountPaise,
        });
      }
      await tx.restaurantTable.updateMany({ where: { id: customer.tableId, status: "AVAILABLE" }, data: { status: "OCCUPIED" } });
      await tx.notificationEvent.create({
        data: { orderId: created.id, customerId: customer.customerId, template: "order.submitted", payload: { reference: created.reference } },
      });
      await audit(tx, {
        actor: { type: "CUSTOMER", id: customer.customerId },
        action: "order.submitted",
        entityType: "Order",
        entityId: created.id,
        after: { reference: created.reference, totalPaise: created.totalPaise, items: quote.lines.length },
      });
      return created;
    });
    publishOrderUpdate(order);
    return { order, duplicate: false };
  } catch (err) {
    if (isUniqueViolation(err)) {
      // A concurrent retry with the same idempotency key won the race — return its order.
      const winner = await prisma.order.findUnique({ where: { customerSessionId_idempotencyKey: key } });
      if (winner) return { order: winner, duplicate: true };
    }
    throw err;
  }
}
