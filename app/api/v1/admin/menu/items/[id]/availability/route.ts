import { z } from "zod";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { setItemAvailability } from "@/lib/admin/menu";

/** POST — mark an item available/unavailable ("86"). Allowed for menu managers and supervisors. */
export const POST = staffRoute(
  { permission: [PERMISSIONS.MENU_MANAGE, PERMISSIONS.ORDER_CHANGE], body: z.object({ isAvailable: z.boolean() }) },
  async ({ staff, params, body }) => ({ item: await setItemAvailability(params.id, body.isAvailable, { type: "STAFF", id: staff.userId, label: staff.name }) }),
);
