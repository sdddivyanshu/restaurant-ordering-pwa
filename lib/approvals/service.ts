// Supervisor approval workflow and customer responses to proposed changes.
// Core invariant: an order reaches the kitchen only via approveOrder(), which (a) requires the
// order.approve permission, (b) approves exactly the version the supervisor reviewed, and
// (c) enqueues one deduplicated outbox event in the same transaction.

import { withTx, type Tx } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { lockOrder } from "@/lib/db/locks";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import { transitionOrder } from "@/lib/orders/transition";
import { enqueueOutbox, kickDispatcher } from "@/lib/kitchen/outbox";
import { publishOrderUpdate } from "@/lib/notifications/bus";
import { audit, type Actor } from "@/lib/audit";
import type { StaffContext } from "@/lib/auth/staff-session";
import type { CustomerContext } from "@/lib/auth/customer-session";
import { orderVisibilityFilter } from "@/lib/auth/customer-session";
import { quoteCart, serializeQuote } from "@/lib/pricing/quote";
import type { CartLineInput } from "@/lib/validation/schemas";
import { createOrderItemsFromQuote, totalsFromQuote } from "@/lib/orders/create-items";
import { onOrderClosedUnfulfilled } from "@/lib/orders/side-effects";
import { reverseRedemptionForOrder } from "@/lib/loyalty/service";
import type { OrderStatusValue } from "@/lib/orders/state-machine";

const staffActor = (s: StaffContext): Actor => ({ type: "STAFF", id: s.userId, label: s.name });

async function loadLocked(tx: Tx, orderId: string) {
  if (!(await lockOrder(tx, orderId))) throw notFound("Order not found");
  return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { approval: true, redemption: true } });
}

type Locked = Awaited<ReturnType<typeof loadLocked>>;

/** Bring an order in a change/clarification state back to PENDING_APPROVAL via valid transitions. */
async function backToPending(tx: Tx, order: Locked, staff: StaffContext, note: string) {
  let o: Locked = order;
  if (o.status === "CUSTOMER_CONFIRMATION_REQUIRED") {
    await tx.orderChangeRequest.updateMany({ where: { orderId: o.id, status: "PROPOSED" }, data: { status: "SUPERSEDED" } });
    o = await transitionOrder(tx, o, "PENDING_APPROVAL", { actor: staffActor(staff), authority: staff.permissions, note });
  } else if (o.status === "CHANGE_REQUESTED") {
    o = await transitionOrder(tx, o, "PENDING_APPROVAL", {
      actor: staffActor(staff),
      authority: staff.permissions,
      note,
      data: { needsClarification: false },
    });
  }
  return o;
}

export async function approveOrder(staff: StaffContext, orderId: string, expectedVersion: number) {
  const result = await withTx(async (tx) => {
    const order = await loadLocked(tx, orderId);
    // Repeated approval (double click, retry, second supervisor): idempotent, no second dispatch.
    if (order.approval?.decision === "APPROVED") return { order, alreadyApproved: true };
    if (order.status !== "PENDING_APPROVAL") {
      throw conflict("INVALID_STATE", `This order is ${order.status.replaceAll("_", " ").toLowerCase()} and cannot be approved now.`);
    }
    if (order.version !== expectedVersion) {
      throw conflict("STALE_VERSION", "The order changed since you opened it. Review the latest version before approving.");
    }
    const updated = await transitionOrder(tx, order, "APPROVED", {
      actor: staffActor(staff),
      authority: staff.permissions,
      data: { approvedById: staff.userId, approvedVersion: order.version, needsClarification: false },
      auditMeta: { version: order.version, totalPaise: order.totalPaise },
    });
    await tx.orderApproval.create({ data: { orderId, decision: "APPROVED", orderVersion: order.version, actorId: staff.userId } });
    await enqueueOutbox(tx, {
      type: "KITCHEN_DISPATCH",
      aggregateId: orderId,
      dedupeKey: `kitchen-dispatch:${orderId}:v${order.version}`,
      payload: { orderId, version: order.version },
    });
    return { order: updated, alreadyApproved: false };
  });
  if (!result.alreadyApproved) {
    publishOrderUpdate(result.order);
    kickDispatcher();
  }
  return result;
}

export async function rejectOrder(staff: StaffContext, orderId: string, reason: string) {
  const order = await withTx(async (tx) => {
    let o = await loadLocked(tx, orderId);
    if (o.approval) throw conflict("ALREADY_DECIDED", "This order has already been decided.");
    o = await backToPending(tx, o, staff, "Returned for rejection");
    o = await transitionOrder(tx, o, "REJECTED", {
      actor: staffActor(staff),
      authority: staff.permissions,
      note: reason,
      data: { rejectionReason: reason },
    });
    await tx.orderApproval.create({ data: { orderId, decision: "REJECTED", orderVersion: o.version, actorId: staff.userId, reason } });
    await onOrderClosedUnfulfilled(tx, orderId, staffActor(staff), "Order rejected");
    return o;
  });
  publishOrderUpdate(order);
  return order;
}

export async function flagOrder(staff: StaffContext, orderId: string, note: string) {
  const order = await withTx(async (tx) => {
    const o = await loadLocked(tx, orderId);
    return transitionOrder(tx, o, "CHANGE_REQUESTED", {
      actor: staffActor(staff),
      authority: staff.permissions,
      note,
      data: { needsClarification: true, clarificationNote: note },
    });
  });
  publishOrderUpdate(order);
  return order;
}

export async function resolveFlag(staff: StaffContext, orderId: string, note?: string) {
  const order = await withTx(async (tx) => {
    const o = await loadLocked(tx, orderId);
    if (o.status !== "CHANGE_REQUESTED") throw conflict("INVALID_STATE", "This order is not awaiting clarification.");
    return transitionOrder(tx, o, "PENDING_APPROVAL", {
      actor: staffActor(staff),
      authority: staff.permissions,
      note: note ?? "Clarification resolved",
      data: { needsClarification: false },
    });
  });
  publishOrderUpdate(order);
  return order;
}

export async function proposeChange(
  staff: StaffContext,
  orderId: string,
  input: { lines: CartLineInput[]; reason: string; kind: "SUBSTITUTION" | "QUANTITY" | "CUSTOMIZATION" | "REMOVAL" | "MIXED"; expectedVersion: number },
) {
  const order = await withTx(async (tx) => {
    let o = await loadLocked(tx, orderId);
    if (o.status !== "PENDING_APPROVAL" && o.status !== "CHANGE_REQUESTED") {
      throw conflict("INVALID_STATE", "Changes can only be proposed before approval.");
    }
    if (o.version !== input.expectedVersion) throw conflict("STALE_VERSION", "The order changed since you opened it.");
    const hasReward = o.redemption?.status === "APPLIED";
    const quote = await quoteCart(tx, input.lines, {
      rewardId: hasReward ? o.redemption!.rewardId : null,
      customer: { customerId: o.customerId, verified: true },
      existingRedemption: hasReward,
    });
    if (quote.issues.length) {
      throw unprocessable("PROPOSAL_INVALID", quote.issues[0].message, { issues: quote.issues });
    }
    const serialized = { ...serializeQuote(quote), rewardRemoved: hasReward && !quote.reward };
    await tx.orderChangeRequest.updateMany({ where: { orderId, status: "PROPOSED" }, data: { status: "SUPERSEDED" } });
    const cr = await tx.orderChangeRequest.create({
      data: {
        orderId,
        fromVersion: o.version,
        kind: input.kind,
        reason: input.reason,
        proposedLines: input.lines as unknown as Prisma.InputJsonValue,
        proposedQuote: serialized as unknown as Prisma.InputJsonValue,
        createdById: staff.userId,
      },
    });
    if (o.status === "PENDING_APPROVAL") {
      o = await transitionOrder(tx, o, "CHANGE_REQUESTED", { actor: staffActor(staff), authority: staff.permissions, note: "Change proposed" });
    }
    o = await transitionOrder(tx, o, "CUSTOMER_CONFIRMATION_REQUIRED", {
      actor: staffActor(staff),
      authority: staff.permissions,
      note: input.reason,
      data: { needsClarification: false },
      auditMeta: { changeRequestId: cr.id, kind: input.kind, beforeTotalPaise: o.totalPaise, proposedTotalPaise: quote.totalPaise },
    });
    await audit(tx, {
      actor: staffActor(staff),
      action: "order.change_proposed",
      entityType: "Order",
      entityId: orderId,
      before: { totalPaise: o.totalPaise, version: o.version },
      after: { totalPaise: quote.totalPaise, lines: input.lines.length },
      meta: { reason: input.reason, kind: input.kind },
    });
    return o;
  });
  publishOrderUpdate(order);
  return order;
}

export async function withdrawChange(staff: StaffContext, orderId: string) {
  const order = await withTx(async (tx) => {
    const o = await loadLocked(tx, orderId);
    if (o.status !== "CUSTOMER_CONFIRMATION_REQUIRED") throw conflict("INVALID_STATE", "There is no pending proposal to withdraw.");
    return backToPending(tx, o, staff, "Proposal withdrawn by staff");
  });
  publishOrderUpdate(order);
  return order;
}

export async function addOrderNote(staff: StaffContext, orderId: string, body: string) {
  return withTx(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!order) throw notFound("Order not found");
    const note = await tx.orderNote.create({ data: { orderId, authorId: staff.userId, body } });
    await audit(tx, { actor: staffActor(staff), action: "order.note_added", entityType: "Order", entityId: orderId });
    return note;
  });
}

/** Staff cancellation following the cancellation rules of the state machine. */
export async function cancelOrderByStaff(staff: StaffContext, orderId: string, reason: string) {
  const order = await withTx(async (tx) => {
    let o = await loadLocked(tx, orderId);
    const actor = staffActor(staff);
    if (o.status === "CHANGE_REQUESTED" || o.status === "CUSTOMER_CONFIRMATION_REQUIRED") {
      o = await backToPending(tx, o, staff, "Returned for cancellation");
    }
    const status = o.status as OrderStatusValue;
    if (status === "PREPARING") {
      o = await transitionOrder(tx, o, "CANCEL_REQUESTED", { actor, authority: staff.permissions, note: reason, data: { cancelReason: reason, cancelledById: staff.userId } });
      await tx.kitchenTicket.updateMany({ where: { orderId }, data: { status: "CANCEL_REQUESTED", lockVersion: { increment: 1 } } });
      return o;
    }
    if (status === "CANCEL_REQUESTED") {
      o = await transitionOrder(tx, o, "CANCELLED", { actor, authority: staff.permissions, note: reason });
    } else {
      // PENDING_APPROVAL, APPROVED, QUEUED -> CANCELLED (anything else is rejected by the state machine).
      o = await transitionOrder(tx, o, "CANCELLED", { actor, authority: staff.permissions, note: reason, data: { cancelReason: reason, cancelledById: staff.userId } });
    }
    await onOrderClosedUnfulfilled(tx, orderId, actor, "Order cancelled");
    return o;
  });
  publishOrderUpdate(order);
  return order;
}

// ───────────────────────── Customer actions ─────────────────────────

async function loadCustomerOrderLocked(tx: Tx, customer: CustomerContext, orderId: string) {
  const visible = await tx.order.findFirst({ where: { id: orderId, ...orderVisibilityFilter(customer) }, select: { id: true } });
  // Same 404 whether the order does not exist or belongs to someone else (no IDOR oracle).
  if (!visible) throw notFound("Order not found");
  return loadLocked(tx, orderId);
}

export async function cancelOrderByCustomer(customer: CustomerContext, orderId: string, reason?: string) {
  const order = await withTx(async (tx) => {
    const o = await loadCustomerOrderLocked(tx, customer, orderId);
    const actor: Actor = { type: "CUSTOMER", id: customer.customerId };
    const updated = await transitionOrder(tx, o, "CANCELLED", {
      actor,
      authority: "CUSTOMER",
      note: reason ?? "Cancelled by customer",
      data: { cancelReason: reason ?? "Cancelled by customer" },
    });
    await onOrderClosedUnfulfilled(tx, orderId, actor, "Order cancelled by customer");
    return updated;
  });
  publishOrderUpdate(order);
  return order;
}

export async function respondToChange(customer: CustomerContext, orderId: string, changeRequestId: string, accept: boolean) {
  const order = await withTx(async (tx) => {
    let o = await loadCustomerOrderLocked(tx, customer, orderId);
    if (o.status !== "CUSTOMER_CONFIRMATION_REQUIRED") throw conflict("INVALID_STATE", "There is no change waiting for your confirmation.");
    const cr = await tx.orderChangeRequest.findFirst({ where: { id: changeRequestId, orderId } });
    if (!cr || cr.status !== "PROPOSED" || cr.fromVersion !== o.version) {
      throw conflict("CHANGE_SUPERSEDED", "This proposal is no longer current. Please refresh.");
    }
    const actor: Actor = { type: "CUSTOMER", id: customer.customerId };
    if (!accept) {
      await tx.orderChangeRequest.update({ where: { id: cr.id }, data: { status: "DECLINED", respondedAt: new Date() } });
      return transitionOrder(tx, o, "PENDING_APPROVAL", { actor, authority: "CUSTOMER", note: "Customer declined the proposed changes" });
    }

    const hasReward = o.redemption?.status === "APPLIED";
    const quote = await quoteCart(tx, cr.proposedLines as unknown as CartLineInput[], {
      rewardId: hasReward ? o.redemption!.rewardId : null,
      customer: { customerId: o.customerId, verified: true },
      existingRedemption: hasReward,
    });
    const proposedTotal = (cr.proposedQuote as { totalPaise: number }).totalPaise;
    if (quote.issues.length || quote.totalPaise !== proposedTotal) {
      throw conflict("CHANGE_NO_LONGER_VALID", "Something changed since this proposal was sent. Staff will send an updated proposal.");
    }
    const newVersion = o.version + 1;
    await createOrderItemsFromQuote(tx, orderId, newVersion, quote);
    if (hasReward) {
      if (!quote.reward) await reverseRedemptionForOrder(tx, orderId, actor, "Reward no longer applicable after change");
      else await tx.rewardRedemption.update({ where: { orderId }, data: { discountPaise: quote.discountPaise } });
    }
    await tx.orderChangeRequest.update({ where: { id: cr.id }, data: { status: "ACCEPTED", respondedAt: new Date() } });
    o = await transitionOrder(tx, o, "PENDING_APPROVAL", {
      actor,
      authority: "CUSTOMER",
      note: "Customer accepted the proposed changes",
      data: { version: newVersion, ...totalsFromQuote(quote) },
      auditMeta: { changeRequestId: cr.id, newVersion, totalPaise: quote.totalPaise },
    });
    return { ...o, version: newVersion };
  });
  publishOrderUpdate(order);
  return order;
}
