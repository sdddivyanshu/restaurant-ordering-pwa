import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { categoryUpsertSchema } from "@/lib/validation/schemas";
import { archiveCategory, saveCategory } from "@/lib/admin/menu";

const actor = (s: { userId: string; name: string }) => ({ type: "STAFF" as const, id: s.userId, label: s.name });

export const PATCH = staffRoute({ permission: PERMISSIONS.MENU_MANAGE, body: categoryUpsertSchema }, async ({ staff, params, body }) => ({
  category: await saveCategory(params.id, body, actor(staff)),
}));

export const DELETE = staffRoute({ permission: PERMISSIONS.MENU_MANAGE }, async ({ staff, params }) => {
  await archiveCategory(params.id, actor(staff));
  return { ok: true };
});
