import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { taxUpsertSchema } from "@/lib/validation/schemas";
import { saveTax } from "@/lib/admin/config";

export const PATCH = staffRoute({ permission: PERMISSIONS.SETTINGS_MANAGE, body: taxUpsertSchema }, async ({ staff, params, body }) => ({
  tax: await saveTax(params.id, body, { type: "STAFF", id: staff.userId, label: staff.name }),
}));
