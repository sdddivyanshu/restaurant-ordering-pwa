import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { markServed } from "@/lib/orders/serve";

/** POST — READY -> SERVED. Requires order.serve (service staff, supervisor, admin). */
export const POST = staffRoute({ permission: PERMISSIONS.ORDER_SERVE, rateLimit: RATE_LIMITS.staffWrite }, async ({ staff, params }) => {
  const order = await markServed(staff, params.id);
  return { status: order.status };
});
