import { NextResponse } from "next/server";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { taxUpsertSchema } from "@/lib/validation/schemas";
import { saveTax } from "@/lib/admin/config";

export const POST = staffRoute({ permission: PERMISSIONS.SETTINGS_MANAGE, body: taxUpsertSchema }, async ({ staff, body }) =>
  NextResponse.json({ tax: await saveTax(null, body, { type: "STAFF", id: staff.userId, label: staff.name }) }, { status: 201 }),
);
