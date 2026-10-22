import { NextResponse } from "next/server";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { rewardUpsertSchema } from "@/lib/validation/schemas";
import { listRewards, saveReward } from "@/lib/admin/config";

export const GET = staffRoute({ permission: PERMISSIONS.SETTINGS_MANAGE }, async () => ({ rewards: await listRewards() }));

export const POST = staffRoute({ permission: PERMISSIONS.SETTINGS_MANAGE, body: rewardUpsertSchema }, async ({ staff, body }) =>
  NextResponse.json({ reward: await saveReward(null, body, { type: "STAFF", id: staff.userId, label: staff.name }) }, { status: 201 }),
);
