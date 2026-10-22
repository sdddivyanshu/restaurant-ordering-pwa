import { NextResponse } from "next/server";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { groupUpsertSchema } from "@/lib/validation/schemas";
import { listGroups, saveGroup } from "@/lib/admin/menu";

const actor = (s: { userId: string; name: string }) => ({ type: "STAFF" as const, id: s.userId, label: s.name });

export const GET = staffRoute({ permission: PERMISSIONS.MENU_MANAGE }, async () => ({ groups: await listGroups() }));

export const POST = staffRoute({ permission: PERMISSIONS.MENU_MANAGE, body: groupUpsertSchema }, async ({ staff, body }) =>
  NextResponse.json({ group: await saveGroup(null, body, actor(staff)) }, { status: 201 }),
);
