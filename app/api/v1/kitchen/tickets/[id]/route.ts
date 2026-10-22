import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { kitchenActionSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { kitchenTicketAction } from "@/lib/kitchen/service";

/** POST — start | ready | flag | clear-flag | confirm-cancel | continue */
export const POST = staffRoute(
  { permission: PERMISSIONS.KITCHEN_UPDATE, body: kitchenActionSchema, rateLimit: RATE_LIMITS.staffWrite },
  async ({ staff, params, body }) => {
    const order = await kitchenTicketAction(staff, params.id, body);
    return { orderStatus: order.status };
  },
);
