import { publicRoute } from "@/lib/http/route";
import { assistantSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { getPublicMenu } from "@/lib/menu/service";
import { answerAssistant } from "@/lib/menu/assistant";

/**
 * POST /api/v1/public/menu/assistant — deterministic dietary assistant grounded in menu records.
 * It only answers; it can never add to the cart or submit an order.
 */
export const POST = publicRoute({ body: assistantSchema, rateLimit: RATE_LIMITS.assistant }, async ({ body }) => {
  const menu = await getPublicMenu(body.lang);
  return answerAssistant(body.query, menu, body.lang);
});
