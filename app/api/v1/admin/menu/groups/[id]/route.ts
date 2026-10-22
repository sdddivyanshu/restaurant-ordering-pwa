import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { groupUpsertSchema } from "@/lib/validation/schemas";
import { archiveGroup, saveGroup } from "@/lib/admin/menu";

const actor = (s: { userId: string; name: string }) => ({ type: "STAFF" as const, id: s.userId, label: s.name });

export const PATCH = staffRoute({ permission: PERMISSIONS.MENU_MANAGE, body: groupUpsertSchema }, async ({ staff, params, body }) => ({
  group: await saveGroup(params.id, body, actor(staff)),
}));

export const DELETE = staffRoute({ permission: PERMISSIONS.MENU_MANAGE }, async ({ staff, params }) => {
  await archiveGroup(params.id, actor(staff));
  return { ok: true };
});
