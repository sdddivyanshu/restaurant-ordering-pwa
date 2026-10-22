import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  approveOrder,
  cancelOrderByCustomer,
  cancelOrderByStaff,
  flagOrder,
  proposeChange,
  rejectOrder,
  resolveFlag,
  respondToChange,
} from "@/lib/approvals/service";
import { processOutbox } from "@/lib/kitchen/outbox";
import { kitchenTicketAction } from "@/lib/kitchen/service";
import { customerOrderView, loadFullOrder } from "@/lib/orders/views";
import { approvedOrder, line, newCustomer, placeOrder, staffLogin } from "../helpers";

describe("supervisor rejection", () => {
  it("records the reason, audits it and never reaches the kitchen", async () => {
    const c = await newCustomer("T3");
    const { order } = await placeOrder(c.ctx, [await line("egg-curry")]);
    const sup = await staffLogin("supervisor");
    await rejectOrder(sup.ctx, order.id, "Out of eggs tonight");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("REJECTED");
    expect(o.rejectionReason).toBe("Out of eggs tonight");
    expect(o.paymentStatus).toBe("VOIDED");
    expect(await prisma.auditLog.count({ where: { entityId: order.id, action: "order.rejected" } })).toBe(1);
    await expect(approveOrder(sup.ctx, order.id, 1)).rejects.toMatchObject({ status: 409 });
    await processOutbox();
    expect(await prisma.kitchenTicket.count({ where: { orderId: order.id } })).toBe(0);
    expect(customerOrderView((await loadFullOrder({ id: order.id }))!).rejectionReason).toBe("Out of eggs tonight");
  });
});

describe("clarification flag", () => {
  it("moves to CHANGE_REQUESTED, blocks approval, and resolves back to pending", async () => {
    const c = await newCustomer("T3");
    const { order } = await placeOrder(c.ctx, [await line("veg-biryani")]);
    const sup = await staffLogin("supervisor");
    await flagOrder(sup.ctx, order.id, "Please confirm: no onions at all?");
    const view = customerOrderView((await loadFullOrder({ id: order.id }))!);
    expect(view.status).toBe("CHANGE_REQUESTED");
    expect(view.clarificationNote).toContain("no onions");
    await expect(approveOrder(sup.ctx, order.id, 1)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await resolveFlag(sup.ctx, order.id, "Confirmed with guest");
    const r = await approveOrder(sup.ctx, order.id, 1);
    expect(r.order.status).toBe("APPROVED");
  });
});

describe("change proposals", () => {
  it("requires explicit customer acceptance; only the accepted version is approved and dispatched", async () => {
    const c = await newCustomer("T3");
    const { order } = await placeOrder(c.ctx, [await line("mutton-rogan-josh"), await line("tandoori-roti", 2)]);
    const sup = await staffLogin("supervisor");

    // Supervisor proposes substituting mutton with butter chicken (price changes).
    await proposeChange(sup.ctx, order.id, {
      expectedVersion: 1,
      kind: "SUBSTITUTION",
      reason: "Mutton is finished — may we substitute butter chicken?",
      lines: [await line("butter-chicken"), await line("tandoori-roti", 2)],
    });
    let o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("CUSTOMER_CONFIRMATION_REQUIRED");
    expect(o.version).toBe(1); // not silently applied
    await expect(approveOrder(sup.ctx, order.id, 1)).rejects.toMatchObject({ code: "INVALID_STATE" });

    const view = customerOrderView((await loadFullOrder({ id: order.id }))!);
    expect(view.changeRequest?.reason).toContain("substitute");
    const cr = view.changeRequest!;

    await respondToChange(c.ctx, order.id, cr.id, true);
    o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("PENDING_APPROVAL");
    expect(o.version).toBe(2);
    // Totals reflect the accepted version: butter chicken 380 + 2 x 40 = 460 + 5% GST = 483.
    expect(o.subtotalPaise).toBe(46000);
    expect(o.totalPaise).toBe(48300);

    // Old approval of v1 is stale.
    await expect(approveOrder(sup.ctx, order.id, 1)).rejects.toMatchObject({ code: "STALE_VERSION" });
    await approveOrder(sup.ctx, order.id, 2);
    await processOutbox();
    const ticket = await prisma.kitchenTicket.findUniqueOrThrow({ where: { orderId: order.id }, include: { items: true } });
    expect(ticket.orderVersion).toBe(2);
    expect(ticket.items.map((i) => i.name).sort()).toEqual(["Butter Chicken", "Tandoori Roti"]);
    // v1 items remain as an immutable historical snapshot.
    expect(await prisma.orderItem.count({ where: { orderId: order.id, version: 1 } })).toBe(2);
  });

  it("returns a declined proposal to the supervisor without changing the order", async () => {
    const c = await newCustomer("T3");
    const { order } = await placeOrder(c.ctx, [await line("paneer-tikka")]);
    const sup = await staffLogin("supervisor");
    await proposeChange(sup.ctx, order.id, { expectedVersion: 1, kind: "QUANTITY", reason: "Only half portion left", lines: [await line("hara-bhara-kebab")] });
    const cr = customerOrderView((await loadFullOrder({ id: order.id }))!).changeRequest!;
    await respondToChange(c.ctx, order.id, cr.id, false);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("PENDING_APPROVAL");
    expect(o.version).toBe(1);
    expect((await prisma.orderChangeRequest.findUniqueOrThrow({ where: { id: cr.id } })).status).toBe("DECLINED");
  });

  it("does not let another customer answer the proposal", async () => {
    const c = await newCustomer("T3");
    const other = await newCustomer("T3");
    const { order } = await placeOrder(c.ctx, [await line("palak-paneer")]);
    const sup = await staffLogin("supervisor");
    await proposeChange(sup.ctx, order.id, { expectedVersion: 1, kind: "MIXED", reason: "Swap", lines: [await line("dal-makhani")] });
    const cr = customerOrderView((await loadFullOrder({ id: order.id }))!).changeRequest!;
    await expect(respondToChange(other.ctx, order.id, cr.id, true)).rejects.toMatchObject({ status: 404 });
  });
});

describe("cancellation rules", () => {
  it("lets a customer cancel only while pending", async () => {
    const c = await newCustomer("T4");
    const { order } = await placeOrder(c.ctx, [await line("jeera-rice")]);
    await cancelOrderByCustomer(c.ctx, order.id, "Changed my mind");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");

    const id2 = await approvedOrder(c.ctx);
    await expect(cancelOrderByCustomer(c.ctx, id2)).rejects.toMatchObject({ status: 403 });
  });

  it("cancels a queued order (ticket cancelled) and requests cancellation while preparing", async () => {
    const c = await newCustomer("T4");
    const sup = await staffLogin("supervisor");
    const kitchen = await staffLogin("kitchen");

    const queued = await approvedOrder(c.ctx);
    await cancelOrderByStaff(sup.ctx, queued, "Guest left");
    expect((await prisma.kitchenTicket.findUniqueOrThrow({ where: { orderId: queued } })).status).toBe("CANCELLED");

    const preparing = await approvedOrder(c.ctx);
    const t = await prisma.kitchenTicket.findUniqueOrThrow({ where: { orderId: preparing } });
    await kitchenTicketAction(kitchen.ctx, t.id, { action: "start" });
    await cancelOrderByStaff(sup.ctx, preparing, "Guest allergy discovered");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: preparing } })).status).toBe("CANCEL_REQUESTED");
    await kitchenTicketAction(kitchen.ctx, t.id, { action: "confirm-cancel" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: preparing } })).status).toBe("CANCELLED");
  });

  it("cancels an approved order before dispatch so it never reaches the kitchen", async () => {
    const c = await newCustomer("T4");
    const { order } = await placeOrder(c.ctx, [await line("rasmalai")]);
    const sup = await staffLogin("supervisor");
    await approveOrder(sup.ctx, order.id, 1);
    await cancelOrderByStaff(sup.ctx, order.id, "Duplicate order");
    await processOutbox();
    expect(await prisma.kitchenTicket.count({ where: { orderId: order.id } })).toBe(0);
    const ev = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: order.id } });
    expect(ev.status).toBe("DONE");
  });
});
