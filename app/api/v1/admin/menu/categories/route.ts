import { NextResponse } from "next/server";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { categoryUpsertSchema } from "@/lib/validation/schemas";
import { listCategories, saveCategory } from "@/lib/admin/menu";

const actor = (s: { userId: string; name: string }) => ({ type: "STAFF" as const, id: s.userId, label: s.name });

export const GET = staffRoute({ permission: PERMISSIONS.MENU_MANAGE }, async () => ({ categories: await listCategories() }));

export const POST = staffRoute({ permission: PERMISSIONS.MENU_MANAGE, body: categoryUpsertSchema }, async ({ staff, body }) =>
  NextResponse.json({ category: await saveCategory(null, body, actor(staff)) }, { status: 201 }),
);
