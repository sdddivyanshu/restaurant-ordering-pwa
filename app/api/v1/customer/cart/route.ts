import { customerRoute } from "@/lib/http/route";
import { quoteSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { prisma } from "@/lib/db/prisma";
import { quoteCart, serializeQuote } from "@/lib/pricing/quote";

/** POST /api/v1/customer/cart — server-side quote of the cart (prices, taxes, discounts, availability). */
export const POST = customerRoute({ body: quoteSchema, rateLimit: RATE_LIMITS.quote }, async ({ customer, body }) => {
  const quote = await quoteCart(prisma, body.lines, {
    rewardId: body.rewardId,
    customer: { customerId: customer.customerId, verified: customer.verified },
  });
  return serializeQuote(quote);
});
