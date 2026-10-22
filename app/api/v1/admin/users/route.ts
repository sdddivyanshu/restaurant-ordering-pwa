import { NextResponse } from "next/server";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { userCreateSchema } from "@/lib/validation/schemas";
import { createUser, listUsers, permissionOptions, roleOptions } from "@/lib/admin/users";

export const GET = staffRoute({ permission: PERMISSIONS.USER_MANAGE }, async () => ({ users: await listUsers(), roles: roleOptions(), permissions: permissionOptions() }));

export const POST = staffRoute({ permission: PERMISSIONS.USER_MANAGE, body: userCreateSchema }, async ({ staff, body }) =>
  NextResponse.json(await createUser(body, { type: "STAFF", id: staff.userId, label: staff.name }), { status: 201 }),
);
