import { customerRoute } from "@/lib/http/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { reorder } from "@/lib/orders/history";

/** POST — build a NEW cart from a past order, revalidated against today's menu. Never submits. */
export const POST = customerRoute({ rateLimit: RATE_LIMITS.quote }, async ({ customer, params }) => reorder(customer, params.id));
