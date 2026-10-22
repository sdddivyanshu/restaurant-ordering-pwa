import { NextResponse } from "next/server";
import { z } from "zod";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { itemUpsertSchema } from "@/lib/validation/schemas";
import { listItems, saveItem } from "@/lib/admin/menu";

const actor = (s: { userId: string; name: string }) => ({ type: "STAFF" as const, id: s.userId, label: s.name });

export const GET = staffRoute(
  {
    permission: PERMISSIONS.MENU_MANAGE,
    query: z.object({
      q: z.string().trim().max(60).optional(),
      categoryId: z.string().max(40).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  async ({ query }) => listItems(query),
);

export const POST = staffRoute({ permission: PERMISSIONS.MENU_MANAGE, body: itemUpsertSchema }, async ({ staff, body }) =>
  NextResponse.json({ item: await saveItem(null, body, actor(staff)) }, { status: 201 }),
);
