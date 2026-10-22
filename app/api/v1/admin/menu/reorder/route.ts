import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { reorderSchema } from "@/lib/validation/schemas";
import { reorderEntities } from "@/lib/admin/menu";

export const POST = staffRoute({ permission: PERMISSIONS.MENU_MANAGE, body: reorderSchema }, async ({ staff, body }) => {
  await reorderEntities(body.entity, body.ids, { type: "STAFF", id: staff.userId, label: staff.name });
  return { ok: true };
});
