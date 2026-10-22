import QRCode from "qrcode";
import { prisma, withTx } from "@/lib/db/prisma";
import { lockTable } from "@/lib/db/locks";
import { ApiError, conflict, notFound } from "@/lib/http/errors";
import { randomToken } from "@/lib/security/tokens";
import { getRestaurantConfig } from "@/lib/settings";
import { appBaseUrl } from "@/lib/env";
import { audit, type Actor } from "@/lib/audit";
import { publish, topics } from "@/lib/notifications/bus";

export function newQrToken() {
  // 144 bits of entropy, URL-safe, opaque (reveals nothing about the table).
  return randomToken(18);
}

export function qrUrlFor(token: string) {
  return `${appBaseUrl()}/t/${token}`;
}

/**
 * Validate a scanned QR token server-side and join (or open) the table's current visit.
 * The table row lock ensures concurrent scans at one table share a single open visit.
 */
export async function openTableVisit(qrToken: string) {
  const table = await prisma.restaurantTable.findUnique({ where: { qrToken } });
  if (!table) throw new ApiError(404, "QR_INVALID", "This QR code is invalid or has been replaced. Please ask a staff member for help.");
  if (table.archivedAt) throw new ApiError(410, "QR_UNASSIGNED", "This QR code is no longer assigned to a table. Please ask a staff member.");
  if (!table.isActive) throw new ApiError(403, "TABLE_DISABLED", "This table is not taking orders right now. Please ask a staff member.");

  const { settings } = await getRestaurantConfig();
  return withTx(async (tx) => {
    await lockTable(tx, table.id);
    const now = new Date();
    let visit = await tx.tableSession.findFirst({ where: { tableId: table.id, status: "OPEN" }, orderBy: { openedAt: "desc" } });
    if (visit && visit.expiresAt <= now) {
      await tx.tableSession.update({ where: { id: visit.id }, data: { status: "CLOSED", closedAt: now } });
      visit = null;
    }
    if (!visit) {
      visit = await tx.tableSession.create({
        data: { tableId: table.id, expiresAt: new Date(now.getTime() + settings.tableSessionHours * 3600_000) },
      });
    }
    return { table: { id: table.id, label: table.label, name: table.name }, visit: { id: visit.id, expiresAt: visit.expiresAt } };
  });
}

export async function qrPng(token: string, size = 600) {
  return QRCode.toBuffer(qrUrlFor(token), { type: "png", width: size, margin: 2, errorCorrectionLevel: "M" });
}

export async function listTables() {
  const tables = await prisma.restaurantTable.findMany({
    where: { archivedAt: null },
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
    include: {
      sessions: { where: { status: "OPEN" }, take: 1, orderBy: { openedAt: "desc" } },
      _count: { select: { orders: { where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "QUEUED", "PREPARING", "READY"] } } } } },
    },
  });
  return tables.map((t) => ({
    id: t.id,
    label: t.label,
    name: t.name,
    seats: t.seats,
    area: t.area,
    isActive: t.isActive,
    status: t.status,
    hasQr: Boolean(t.qrToken),
    qrUrl: t.qrToken ? qrUrlFor(t.qrToken) : null,
    qrTokenRotatedAt: t.qrTokenRotatedAt,
    openVisit: t.sessions[0] ? { id: t.sessions[0].id, openedAt: t.sessions[0].openedAt, expiresAt: t.sessions[0].expiresAt } : null,
    activeOrders: t._count.orders,
  }));
}

export async function tableAction(tableId: string, action: "regenerate-qr" | "revoke-qr" | "close-visit" | "mark-clean" | "archive", actor: Actor) {
  return withTx(async (tx) => {
    if (!(await lockTable(tx, tableId))) throw notFound("Table not found");
    const table = await tx.restaurantTable.findUniqueOrThrow({ where: { id: tableId } });
    const now = new Date();
    switch (action) {
      case "regenerate-qr":
        await tx.restaurantTable.update({ where: { id: tableId }, data: { qrToken: newQrToken(), qrTokenRotatedAt: now } });
        break;
      case "revoke-qr":
        await tx.restaurantTable.update({ where: { id: tableId }, data: { qrToken: null, qrTokenRotatedAt: now } });
        break;
      case "close-visit": {
        const open = await tx.order.count({ where: { tableId, status: { in: ["PENDING_APPROVAL", "CHANGE_REQUESTED", "CUSTOMER_CONFIRMATION_REQUIRED", "APPROVED", "QUEUED", "PREPARING", "READY", "CANCEL_REQUESTED"] } } });
        if (open > 0) throw conflict("ACTIVE_ORDERS", "This table still has active orders. Serve or cancel them first.");
        await tx.tableSession.updateMany({ where: { tableId, status: "OPEN" }, data: { status: "CLOSED", closedAt: now, closedById: actor.id ?? null } });
        // Ends every customer session tied to the visit; new diners must scan again.
        await tx.restaurantTable.update({ where: { id: tableId }, data: { status: "NEEDS_CLEANING" } });
        break;
      }
      case "mark-clean":
        await tx.restaurantTable.update({ where: { id: tableId }, data: { status: "AVAILABLE" } });
        break;
      case "archive":
        await tx.restaurantTable.update({ where: { id: tableId }, data: { archivedAt: now, isActive: false, qrToken: null } });
        break;
    }
    await audit(tx, { actor, action: `table.${action}`, entityType: "RestaurantTable", entityId: tableId, before: { status: table.status, label: table.label } });
    publish(topics.staff, "table.updated", { tableId });
    return tx.restaurantTable.findUniqueOrThrow({ where: { id: tableId } });
  });
}

/** Close visits that passed their expiry (called by the background job). */
export async function expireTableVisits(now = new Date()) {
  const expired = await prisma.tableSession.findMany({ where: { status: "OPEN", expiresAt: { lte: now } }, select: { id: true, tableId: true } });
  for (const v of expired) {
    await prisma.$transaction([
      prisma.tableSession.update({ where: { id: v.id }, data: { status: "CLOSED", closedAt: now } }),
      prisma.restaurantTable.updateMany({ where: { id: v.tableId, status: "OCCUPIED" }, data: { status: "NEEDS_CLEANING" } }),
    ]);
  }
  return expired.length;
}
