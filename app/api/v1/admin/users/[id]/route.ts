import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { userUpdateSchema } from "@/lib/validation/schemas";
import { updateUser } from "@/lib/admin/users";

export const PATCH = staffRoute({ permission: PERMISSIONS.USER_MANAGE, body: userUpdateSchema }, async ({ staff, params, body }) => {
  await updateUser(params.id, body, { type: "STAFF", id: staff.userId, label: staff.name });
  return { ok: true };
});
