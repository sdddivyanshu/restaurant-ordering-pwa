import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { rewardUpsertSchema } from "@/lib/validation/schemas";
import { saveReward } from "@/lib/admin/config";

export const PATCH = staffRoute({ permission: PERMISSIONS.SETTINGS_MANAGE, body: rewardUpsertSchema }, async ({ staff, params, body }) => ({
  reward: await saveReward(params.id, body, { type: "STAFF", id: staff.userId, label: staff.name }),
}));
