import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { tableActionSchema, tableUpsertSchema } from "@/lib/validation/schemas";
import { tableAction } from "@/lib/tables/service";
import { prisma } from "@/lib/db/prisma";
import { conflict, forbidden, notFound } from "@/lib/http/errors";
import { audit } from "@/lib/audit";

/** PATCH — rename / seats / area / activate / deactivate. */
export const PATCH = staffRoute({ permission: PERMISSIONS.TABLE_MANAGE, body: tableUpsertSchema }, async ({ staff, params, body }) => {
  const before = await prisma.restaurantTable.findUnique({ where: { id: params.id } });
  if (!before) throw notFound("Table not found");
  const clash = await prisma.restaurantTable.findUnique({ where: { label: body.label } });
  if (clash && clash.id !== params.id) throw conflict("LABEL_TAKEN", "A table with this label already exists.");
  await prisma.$transaction(async (tx) => {
    await tx.restaurantTable.update({ where: { id: params.id }, data: { ...body, area: body.area ?? null } });
    await audit(tx, { actor: { type: "STAFF", id: staff.userId, label: staff.name }, action: "table.updated", entityType: "RestaurantTable", entityId: params.id, before, after: body });
  });
  return { ok: true };
});

/** POST — regenerate-qr | revoke-qr | close-visit | mark-clean | archive */
export const POST = staffRoute(
  { permission: [PERMISSIONS.TABLE_MANAGE, PERMISSIONS.SERVICE_UPDATE], body: tableActionSchema },
  async ({ staff, params, body }) => {
    // Service staff may close visits and mark tables clean; QR and archive operations need table.manage.
    const operational = body.action === "close-visit" || body.action === "mark-clean";
    if (!operational && !staff.permissions.has(PERMISSIONS.TABLE_MANAGE)) throw forbidden();
    const t = await tableAction(params.id, body.action, { type: "STAFF", id: staff.userId, label: staff.name });
    return { status: t.status, hasQr: Boolean(t.qrToken) };
  },
);
