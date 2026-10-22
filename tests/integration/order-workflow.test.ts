import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { openTableVisit, tableAction } from "@/lib/tables/service";
import { submitOrder } from "@/lib/orders/submit";
import { approveOrder } from "@/lib/approvals/service";
import { processOutbox } from "@/lib/kitchen/outbox";
import { getKitchenBoard, kitchenTicketAction } from "@/lib/kitchen/service";
import { markServed } from "@/lib/orders/serve";
import { recordPayment } from "@/lib/payments/service";
import { awardPointsIfEligible } from "@/lib/loyalty/service";
import { submitFeedback } from "@/lib/feedback/service";
import { listOrderHistory, reorder } from "@/lib/orders/history";
import { customerOrderView, loadFullOrder } from "@/lib/orders/views";
import { ApiError } from "@/lib/http/errors";
import { line, newCustomer, placeOrder, qrTokenFor, staffLogin, totalFor } from "../helpers";

describe("QR validation", () => {
  it("opens a visit for a valid token and reuses it for a second scan", async () => {
    const token = await qrTokenFor("T2");
    const a = await openTableVisit(token);
    const b = await openTableVisit(token);
    expect(a.table.label).toBe("T2");
    expect(b.visit.id).toBe(a.visit.id);
  });

  it("rejects unknown, revoked and disabled tokens with friendly errors", async () => {
    await expect(openTableVisit("this-token-does-not-exist")).rejects.toMatchObject({ code: "QR_INVALID", status: 404 });

    const admin = await staffLogin("admin");
    const t10 = await prisma.restaurantTable.findUniqueOrThrow({ where: { label: "T10" } });
    const oldToken = t10.qrToken!;
    await tableAction(t10.id, "regenerate-qr", { type: "STAFF", id: admin.ctx.userId });
    await expect(openTableVisit(oldToken)).rejects.toMatchObject({ code: "QR_INVALID" });

    await prisma.restaurantTable.update({ where: { id: t10.id }, data: { isActive: false } });
    const fresh = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: t10.id } });
    await expect(openTableVisit(fresh.qrToken!)).rejects.toMatchObject({ code: "TABLE_DISABLED" });
    await prisma.restaurantTable.update({ where: { id: t10.id }, data: { isActive: true } });

    await tableAction(t10.id, "revoke-qr", { type: "STAFF", id: admin.ctx.userId });
    expect((await prisma.restaurantTable.findUniqueOrThrow({ where: { id: t10.id } })).qrToken).toBeNull();
    await tableAction(t10.id, "regenerate-qr", { type: "STAFF", id: admin.ctx.userId });
  });
});

describe("customer registration", () => {
  it("validates the phone number and stores consent separately", async () => {
    const { registerCustomer } = await import("@/lib/customers/service");
    await expect(
      registerCustomer({ qrToken: await qrTokenFor("T1"), name: "X", phone: "12345", marketingConsent: false, language: "en" }),
    ).rejects.toBeInstanceOf(ApiError);
    const c = await newCustomer("T1");
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: c.ctx.customerId } });
    expect(customer.privacyConsentAt).toBeTruthy();
    expect(customer.marketingConsent).toBe(false);
    expect(c.ctx.tableLabel).toBe("T1");
    expect(c.ctx.verified).toBe(false);
  });
});

describe("order submission", () => {
  it("creates a PENDING_APPROVAL order with server-computed totals and an immutable snapshot", async () => {
    const c = await newCustomer("T1");
    const lines = [await line("paneer-butter-masala", 1, { "portion": ["Large"], "curry-addons": ["Extra butter", "Extra cheese"] }), await line("naan", 2, { "naan-style": ["Garlic"] })];
    const { order, duplicate } = await placeOrder(c.ctx, lines);
    expect(duplicate).toBe(false);
    expect(order.status).toBe("PENDING_APPROVAL");
    // Paneer 320 + large 80 + butter 30 + cheese 40 = 470; naan (60+25) x2 = 170; subtotal 640; GST 5% = 32
    expect(order.subtotalPaise).toBe(64000);
    expect(order.taxPaise).toBe(3200);
    expect(order.totalPaise).toBe(67200);
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, include: { customizations: true } });
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.nameSnapshot === "Paneer Butter Masala")!.customizations.map((x) => x.optionName).sort()).toEqual(["Extra butter", "Extra cheese", "Large", "Medium"]);
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } });
    expect(history.map((h) => h.toStatus)).toEqual(["PENDING_APPROVAL"]);
  });

  it("is idempotent: repeating the same submission returns the same order", async () => {
    const c = await newCustomer("T1");
    const lines = [await line("dal-makhani")];
    const key = randomUUID();
    const expected = await totalFor(c.ctx, lines);
    const [a, b] = await Promise.all([
      submitOrder(c.ctx, { lines, expectedTotalPaise: expected, idempotencyKey: key }),
      submitOrder(c.ctx, { lines, expectedTotalPaise: expected, idempotencyKey: key }),
    ]);
    expect(a.order.id).toBe(b.order.id);
    const third = await submitOrder(c.ctx, { lines, expectedTotalPaise: expected, idempotencyKey: key });
    expect(third.duplicate).toBe(true);
    expect(await prisma.order.count({ where: { customerSessionId: c.ctx.sessionId, idempotencyKey: key } })).toBe(1);
  });

  it("rejects a client total that does not match the server price (unauthorized price modification)", async () => {
    const c = await newCustomer("T1");
    const lines = [await line("butter-chicken")];
    await expect(submitOrder(c.ctx, { lines, expectedTotalPaise: 100, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "PRICE_CHANGED", status: 409 });
  });

  it("rejects unavailable items and invalid customizations", async () => {
    const c = await newCustomer("T1");
    const fish = await line("fish-amritsari");
    await expect(submitOrder(c.ctx, { lines: [fish], expectedTotalPaise: 0, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "CART_INVALID" });
    const dal = await line("dal-makhani");
    const noPortion = { ...dal, selections: [] }; // required "Portion" missing
    await expect(submitOrder(c.ctx, { lines: [noPortion], expectedTotalPaise: 0, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "CART_INVALID" });
  });

  it("detects a price change between review and submission", async () => {
    const c = await newCustomer("T1");
    const lines = [await line("jeera-rice")];
    const before = await totalFor(c.ctx, lines);
    await prisma.menuItem.update({ where: { slug: "jeera-rice" }, data: { basePricePaise: { increment: 2000 } } });
    try {
      await expect(submitOrder(c.ctx, { lines, expectedTotalPaise: before, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "PRICE_CHANGED" });
      const ok = await placeOrder(c.ctx, lines);
      expect(ok.order.totalPaise).toBeGreaterThan(before);
    } finally {
      await prisma.menuItem.update({ where: { slug: "jeera-rice" }, data: { basePricePaise: { decrement: 2000 } } });
    }
  });
});

describe("approval → kitchen → served → paid (critical path)", () => {
  it("keeps pending orders out of the kitchen and dispatches exactly one ticket after approval", async () => {
    const c = await newCustomer("T2");
    const { order } = await placeOrder(c.ctx, [await line("butter-chicken"), await line("naan", 2), await line("masala-chai")]);

    // Pending orders are invisible to the KDS and have no ticket / outbox event.
    let board = await getKitchenBoard();
    expect(board.active.some((t) => t.orderId === order.id)).toBe(false);
    expect(await prisma.kitchenTicket.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: order.id } })).toBe(0);
    await processOutbox();
    expect(await prisma.kitchenTicket.count({ where: { orderId: order.id } })).toBe(0);

    const sup = await staffLogin("supervisor");
    const first = await approveOrder(sup.ctx, order.id, order.version);
    expect(first.alreadyApproved).toBe(false);
    // Approved but not yet dispatched: still no ticket until the outbox runs.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("APPROVED");

    // Repeated approval does not enqueue a second dispatch.
    const again = await approveOrder(sup.ctx, order.id, order.version);
    expect(again.alreadyApproved).toBe(true);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: order.id } })).toBe(1);

    await processOutbox();
    await processOutbox();
    const tickets = await prisma.kitchenTicket.findMany({ where: { orderId: order.id }, include: { items: true } });
    expect(tickets).toHaveLength(1);
    expect(tickets[0].items).toHaveLength(3);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("QUEUED");

    board = await getKitchenBoard();
    const ticket = board.active.find((t) => t.orderId === order.id)!;
    expect(ticket).toBeTruthy();
    // No customer PII on kitchen tickets.
    expect(JSON.stringify(ticket)).not.toContain("Test Diner");
    expect(JSON.stringify(ticket)).not.toContain(c.phone.slice(-6));

    const kitchen = await staffLogin("kitchen");
    await expect(kitchenTicketAction(kitchen.ctx, ticket.id, { action: "ready" })).rejects.toMatchObject({ status: 409 });
    await kitchenTicketAction(kitchen.ctx, ticket.id, { action: "start" });
    await kitchenTicketAction(kitchen.ctx, ticket.id, { action: "ready" });

    // Customer sees live status.
    const view = customerOrderView((await loadFullOrder({ id: order.id }))!);
    expect(view.status).toBe("READY");
    expect(view.timeline.map((t) => t.status)).toEqual(["PENDING_APPROVAL", "APPROVED", "QUEUED", "PREPARING", "READY"]);

    const service = await staffLogin("service");
    await markServed(service.ctx, order.id);

    const cashier = await staffLogin("cashier");
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fresh.status).toBe("SERVED");
    expect(fresh.paymentStatus).toBe("UNPAID");
    await recordPayment(cashier.ctx, { orderId: order.id, amountPaise: fresh.totalPaise, method: "CASH", idempotencyKey: randomUUID() });

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { receipt: true } });
    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.status).toBe("SERVED"); // payment never overwrites the operational status
    expect(paid.receipt?.number).toMatch(/^RCPT-/);

    // Loyalty: awarded exactly once, even if the award is triggered again.
    const earned = await prisma.loyaltyLedgerEntry.findMany({ where: { orderId: order.id, type: "EARN" } });
    expect(earned).toHaveLength(1);
    expect(earned[0].points).toBe(Math.floor((paid.subtotalPaise - paid.discountPaise) / 1000));
    await prisma.$transaction((tx) => awardPointsIfEligible(tx, order.id));
    expect(await prisma.loyaltyLedgerEntry.count({ where: { orderId: order.id, type: "EARN" } })).toBe(1);

    // Feedback persists once.
    const fb = await submitFeedback(c.ctx, { orderId: order.id, overall: 5, food: 5, service: 4, comment: "Great!", itemRatings: [] });
    expect(fb.id).toBeTruthy();
    await expect(submitFeedback(c.ctx, { orderId: order.id, overall: 1, food: 1, service: 1, itemRatings: [] })).rejects.toMatchObject({ code: "ALREADY_SUBMITTED" });

    // History and reorder.
    const history = await listOrderHistory(c.ctx);
    expect(history.rows.some((r) => r.id === order.id && r.feedbackSubmitted)).toBe(true);
    const re = await reorder(c.ctx, order.id);
    expect(re.lines).toHaveLength(3);
    expect(re.quote.issues).toHaveLength(0);
    // Reorder never creates an order.
    expect(await prisma.order.count({ where: { customerSessionId: c.ctx.sessionId } })).toBe(1);
  });

  it("serialises concurrent approvals into a single ticket", async () => {
    const c = await newCustomer("T2");
    const { order } = await placeOrder(c.ctx, [await line("chana-masala")]);
    const s1 = await staffLogin("supervisor");
    const s2 = await staffLogin("admin");
    const results = await Promise.allSettled([approveOrder(s1.ctx, order.id, 1), approveOrder(s2.ctx, order.id, 1), approveOrder(s1.ctx, order.id, 1)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(results.filter((r) => r.status === "fulfilled" && !r.value.alreadyApproved)).toHaveLength(1);
    await Promise.all([processOutbox(), processOutbox()]);
    expect(await prisma.kitchenTicket.count({ where: { orderId: order.id } })).toBe(1);
    expect(await prisma.orderApproval.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("refuses to approve a stale version", async () => {
    const c = await newCustomer("T2");
    const { order } = await placeOrder(c.ctx, [await line("jeera-rice")]);
    const sup = await staffLogin("supervisor");
    await expect(approveOrder(sup.ctx, order.id, 99)).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("closing a table visit ends customer sessions and separates future visits", async () => {
    const c = await newCustomer("T12");
    const admin = await staffLogin("admin");
    const t12 = await prisma.restaurantTable.findUniqueOrThrow({ where: { label: "T12" } });
    await tableAction(t12.id, "close-visit", { type: "STAFF", id: admin.ctx.userId });
    const { resolveCustomerSession } = await import("@/lib/auth/customer-session");
    expect(await resolveCustomerSession(c.token)).toEqual({ ok: false, problem: "TABLE_CLOSED" });
    const next = await newCustomer("T12");
    expect(next.ctx.tableSessionId).not.toBe(c.ctx.tableSessionId);
  });
});
