import { NextResponse } from "next/server";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { tableUpsertSchema } from "@/lib/validation/schemas";
import { listTables, newQrToken } from "@/lib/tables/service";
import { prisma } from "@/lib/db/prisma";
import { conflict } from "@/lib/http/errors";
import { audit } from "@/lib/audit";

export const GET = staffRoute({ permission: [PERMISSIONS.TABLE_MANAGE, PERMISSIONS.ORDER_VIEW, PERMISSIONS.SERVICE_VIEW] }, async () => ({ tables: await listTables() }));

export const POST = staffRoute({ permission: PERMISSIONS.TABLE_MANAGE, body: tableUpsertSchema }, async ({ staff, body }) => {
  if (await prisma.restaurantTable.findUnique({ where: { label: body.label } })) throw conflict("LABEL_TAKEN", "A table with this label already exists.");
  const max = await prisma.restaurantTable.aggregate({ _max: { displayOrder: true } });
  const table = await prisma.$transaction(async (tx) => {
    const t = await tx.restaurantTable.create({ data: { ...body, area: body.area ?? null, qrToken: newQrToken(), qrTokenRotatedAt: new Date(), displayOrder: (max._max.displayOrder ?? 0) + 1 } });
    await audit(tx, { actor: { type: "STAFF", id: staff.userId, label: staff.name }, action: "table.created", entityType: "RestaurantTable", entityId: t.id, after: body });
    return t;
  });
  return NextResponse.json({ table: { id: table.id, label: table.label } }, { status: 201 });
});
