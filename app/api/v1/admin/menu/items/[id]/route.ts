import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { itemUpsertSchema } from "@/lib/validation/schemas";
import { archiveItem, getItemForEdit, saveItem } from "@/lib/admin/menu";

const actor = (s: { userId: string; name: string }) => ({ type: "STAFF" as const, id: s.userId, label: s.name });

export const GET = staffRoute({ permission: PERMISSIONS.MENU_MANAGE }, async ({ params }) => ({ item: await getItemForEdit(params.id) }));

/** PATCH — full item update. Price changes are only possible here (menu.manage) and are audit-logged. */
export const PATCH = staffRoute({ permission: PERMISSIONS.MENU_MANAGE, body: itemUpsertSchema }, async ({ staff, params, body }) => ({
  item: await saveItem(params.id, body, actor(staff)),
}));

export const DELETE = staffRoute({ permission: PERMISSIONS.MENU_MANAGE }, async ({ staff, params }) => {
  await archiveItem(params.id, actor(staff));
  return { ok: true };
});
