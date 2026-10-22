// Kitchen Display System operations. The board is built from KitchenTicket rows only, which
// exist solely for dispatched (approved) orders — pending orders are structurally invisible.

import { prisma, withTx } from "@/lib/db/prisma";
import type { KitchenStatus } from "@/lib/generated/prisma/client";
import { lockOrder } from "@/lib/db/locks";
import { conflict, notFound } from "@/lib/http/errors";
import { transitionOrder } from "@/lib/orders/transition";
import { onOrderClosedUnfulfilled } from "@/lib/orders/side-effects";
import { audit, type Actor } from "@/lib/audit";
import { publish, publishOrderUpdate, topics } from "@/lib/notifications/bus";
import type { StaffContext } from "@/lib/auth/staff-session";
import { getRestaurantConfig } from "@/lib/settings";

const ACTIVE: KitchenStatus[] = ["QUEUED", "PREPARING", "READY", "CANCEL_REQUESTED"];

export async function getKitchenBoard() {
  const recentCutoff = new Date(Date.now() - 3 * 3600_000);
  const [active, recent, { settings }] = await Promise.all([
    prisma.kitchenTicket.findMany({
      where: { status: { in: ACTIVE } },
      include: { items: { orderBy: { id: "asc" } }, order: { select: { status: true, version: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.kitchenTicket.findMany({
      where: { status: { in: ["COMPLETED", "CANCELLED"] }, updatedAt: { gte: recentCutoff } },
      include: { items: { orderBy: { id: "asc" } }, order: { select: { status: true, version: true } } },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
    getRestaurantConfig(),
  ]);
  const now = Date.now();
  // Deliberately no customer name / phone: the kitchen only needs table and preparation data.
  const view = (t: (typeof active)[number]) => {
    const startRef = t.startedAt ?? t.createdAt;
    const elapsedMin = Math.floor((now - t.createdAt.getTime()) / 60_000);
    const delayed = (t.status === "QUEUED" || t.status === "PREPARING") && now - startRef.getTime() > t.targetMinutes * 60_000;
    return {
      id: t.id,
      orderId: t.orderId,
      orderRef: t.orderRef,
      tableLabel: t.tableLabel,
      status: t.status,
      orderStatus: t.order.status,
      priority: t.priority,
      targetMinutes: t.targetMinutes,
      flag: t.flag,
      flagNote: t.flagNote,
      notes: t.notes,
      createdAt: t.createdAt,
      startedAt: t.startedAt,
      readyAt: t.readyAt,
      completedAt: t.completedAt,
      elapsedMinutes: elapsedMin,
      isDelayed: delayed || t.flag === "DELAYED",
      prepMinutes: t.items.reduce((m, i) => Math.max(m, i.prepMinutes), 0),
      allergenAlerts: [...new Set(t.items.flatMap((i) => i.allergens))],
      items: t.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, modifiers: i.modifiers, notes: i.notes, allergens: i.allergens, dietType: i.dietType })),
    };
  };
  return {
    active: active.map(view),
    recent: recent.map(view),
    counts: {
      queued: active.filter((t) => t.status === "QUEUED").length,
      preparing: active.filter((t) => t.status === "PREPARING").length,
      ready: active.filter((t) => t.status === "READY").length,
      cancelRequested: active.filter((t) => t.status === "CANCEL_REQUESTED").length,
    },
    targetMinutes: settings.kitchenTargetMinutes,
  };
}

type KitchenAction =
  | { action: "start" }
  | { action: "ready" }
  | { action: "flag"; flag: "DELAYED" | "SHORTAGE" | "ISSUE"; note: string }
  | { action: "clear-flag" }
  | { action: "confirm-cancel" }
  | { action: "continue" };

export async function kitchenTicketAction(staff: StaffContext, ticketId: string, input: KitchenAction) {
  const actor: Actor = { type: "STAFF", id: staff.userId, label: staff.name };
  const result = await withTx(async (tx) => {
    const ticketRef = await tx.kitchenTicket.findUnique({ where: { id: ticketId }, select: { orderId: true } });
    if (!ticketRef) throw notFound("Ticket not found");
    await lockOrder(tx, ticketRef.orderId);
    const ticket = await tx.kitchenTicket.findUniqueOrThrow({ where: { id: ticketId } });
    const order = await tx.order.findUniqueOrThrow({ where: { id: ticket.orderId } });

    const moveTicket = async (from: KitchenStatus, to: KitchenStatus, data: Record<string, unknown> = {}) => {
      const res = await tx.kitchenTicket.updateMany({
        where: { id: ticketId, status: from, lockVersion: ticket.lockVersion },
        data: { ...data, status: to, lockVersion: { increment: 1 } },
      });
      if (res.count !== 1) throw conflict("CONCURRENT_UPDATE", "This ticket was just updated. Refresh the board.");
    };

    switch (input.action) {
      case "start": {
        if (ticket.status !== "QUEUED") throw conflict("INVALID_STATE", "Only queued tickets can be started.");
        await transitionOrder(tx, order, "PREPARING", { actor, authority: staff.permissions });
        await moveTicket("QUEUED", "PREPARING", { startedAt: new Date() });
        break;
      }
      case "ready": {
        if (ticket.status !== "PREPARING") throw conflict("INVALID_STATE", "Start the ticket before marking it ready.");
        await transitionOrder(tx, order, "READY", { actor, authority: staff.permissions });
        await moveTicket("PREPARING", "READY", { readyAt: new Date(), flag: "NONE" });
        break;
      }
      case "flag": {
        await tx.kitchenTicket.update({
          where: { id: ticketId },
          data: { flag: input.flag, flagNote: input.note, flaggedAt: new Date(), flagResolved: false, lockVersion: { increment: 1 } },
        });
        await audit(tx, { actor, action: `kitchen.flag.${input.flag.toLowerCase()}`, entityType: "KitchenTicket", entityId: ticketId, meta: { note: input.note, orderRef: ticket.orderRef } });
        break;
      }
      case "clear-flag": {
        await tx.kitchenTicket.update({ where: { id: ticketId }, data: { flag: "NONE", flagResolved: true, lockVersion: { increment: 1 } } });
        await audit(tx, { actor, action: "kitchen.flag.cleared", entityType: "KitchenTicket", entityId: ticketId });
        break;
      }
      case "confirm-cancel": {
        if (ticket.status !== "CANCEL_REQUESTED") throw conflict("INVALID_STATE", "No cancellation was requested for this ticket.");
        await transitionOrder(tx, order, "CANCELLED", { actor, authority: staff.permissions, note: "Kitchen confirmed cancellation" });
        await moveTicket("CANCEL_REQUESTED", "CANCELLED", { completedAt: new Date() });
        await onOrderClosedUnfulfilled(tx, order.id, actor, "Order cancelled");
        break;
      }
      case "continue": {
        if (ticket.status !== "CANCEL_REQUESTED") throw conflict("INVALID_STATE", "No cancellation was requested for this ticket.");
        await transitionOrder(tx, order, "PREPARING", { actor, authority: staff.permissions, note: "Too late to cancel — preparation continues" });
        await moveTicket("CANCEL_REQUESTED", "PREPARING");
        break;
      }
    }
    return tx.order.findUniqueOrThrow({ where: { id: order.id } });
  });
  publish(topics.staff, "kitchen.ticket", { ticketId, action: input.action });
  publishOrderUpdate(result);
  return result;
}
