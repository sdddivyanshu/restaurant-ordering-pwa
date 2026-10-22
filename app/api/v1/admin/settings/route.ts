import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { settingsUpdateSchema } from "@/lib/validation/schemas";
import { getSettingsForAdmin, updateSettings } from "@/lib/admin/config";

export const GET = staffRoute({ permission: PERMISSIONS.SETTINGS_MANAGE }, async () => getSettingsForAdmin());

export const PATCH = staffRoute({ permission: PERMISSIONS.SETTINGS_MANAGE, body: settingsUpdateSchema }, async ({ staff, body }) => {
  await updateSettings(body, { type: "STAFF", id: staff.userId, label: staff.name });
  return getSettingsForAdmin();
});
