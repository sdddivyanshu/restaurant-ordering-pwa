import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { cancelRequestByCustomer, createServiceRequest, listCustomerRequests, staffRequestAction } from "@/lib/service-requests/service";
import { submitFeedback, listFeedback, resolveFeedback } from "@/lib/feedback/service";
import { getAnalytics, exportCsv, defaultRange } from "@/lib/analytics/service";
import { getPublicMenu } from "@/lib/menu/service";
import { answerAssistant } from "@/lib/menu/assistant";
import { recordPayment } from "@/lib/payments/service";
import { markServed } from "@/lib/orders/serve";
import { kitchenTicketAction } from "@/lib/kitchen/service";
import * as customerServiceRoute from "@/app/api/v1/customer/service-requests/route";
import { COOKIE_CUSTOMER } from "@/lib/auth/cookies";
import { apiRequest, approvedOrder, line, newCustomer, placeOrder, routeParams, staffLogin } from "../helpers";

describe("service requests", () => {
  it("suppresses duplicate taps and lets only staff complete requests", async () => {
    const c = await newCustomer("T11");
    const [a, b, d] = await Promise.all([
      createServiceRequest(c.ctx, { type: "WATER" }),
      createServiceRequest(c.ctx, { type: "WATER" }),
      createServiceRequest(c.ctx, { type: "WATER" }),
    ]);
    expect(new Set([a.request.id, b.request.id, d.request.id]).size).toBe(1);
    expect([a, b, d].filter((r) => !r.duplicate)).toHaveLength(1);
    const waiter = await createServiceRequest(c.ctx, { type: "WAITER" });
    expect(waiter.duplicate).toBe(false);

    const staff = await staffLogin("service");
    await staffRequestAction(staff.ctx, a.request.id, "acknowledge");
    // Customer can no longer cancel once acknowledged, and has no "complete" capability at all.
    await expect(cancelRequestByCustomer(c.ctx, a.request.id)).rejects.toMatchObject({ status: 404 });
    await staffRequestAction(staff.ctx, a.request.id, "complete");
    const r = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: a.request.id } });
    expect(r.status).toBe("COMPLETED");
    expect(r.assignedToId).toBe(staff.ctx.userId);
    await expect(staffRequestAction(staff.ctx, a.request.id, "complete")).rejects.toMatchObject({ code: "INVALID_STATE" });

    // After completion a new request of the same type is allowed.
    expect((await createServiceRequest(c.ctx, { type: "WATER" })).duplicate).toBe(false);
    expect((await listCustomerRequests(c.ctx)).length).toBeGreaterThanOrEqual(3);
  });

  it("rate-limits request flooding at the API", async () => {
    const c = await newCustomer("T11");
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await customerServiceRoute.POST(
        apiRequest("/api/v1/customer/service-requests", { body: { type: "CUSTOM", message: `Need item ${i}` }, cookies: { [COOKIE_CUSTOMER]: c.token } }),
        routeParams(),
      );
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});

describe("feedback", () => {
  it("only accepts feedback for served orders and flags complaints for staff resolution", async () => {
    const c = await newCustomer("T11");
    const { order } = await placeOrder(c.ctx, [await line("jeera-rice")]);
    await expect(submitFeedback(c.ctx, { orderId: order.id, overall: 5, food: 5, service: 5, itemRatings: [] })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });

    const id = await approvedOrder(c.ctx);
    const kitchen = await staffLogin("kitchen");
    const t = await prisma.kitchenTicket.findUniqueOrThrow({ where: { orderId: id } });
    await kitchenTicketAction(kitchen.ctx, t.id, { action: "start" });
    await kitchenTicketAction(kitchen.ctx, t.id, { action: "ready" });
    await markServed((await staffLogin("service")).ctx, id);
    const items = await prisma.orderItem.findMany({ where: { orderId: id } });
    const fb = await submitFeedback(c.ctx, { orderId: id, overall: 2, food: 3, service: 1, comment: "Slow", itemRatings: [{ orderItemId: items[0].id, rating: 3 }] });
    expect(fb.isComplaint).toBe(true);
    const list = await listFeedback("unresolved", 1, 50);
    expect(list.rows.some((r) => r.id === fb.id)).toBe(true);
    await resolveFeedback((await staffLogin("admin")).ctx, fb.id, "Called guest and apologised");
    expect((await prisma.feedback.findUniqueOrThrow({ where: { id: fb.id } })).status).toBe("RESOLVED");
  });
});

describe("analytics", () => {
  it("aggregates real stored data and reflects new paid orders", async () => {
    const range = { ...defaultRange(), includeDemo: true };
    const before = await getAnalytics(range);
    expect(before.summary.acceptedOrders).toBeGreaterThan(0);
    expect(before.bestsellers.length).toBeGreaterThan(0);
    expect(before.demoOrdersInRange).toBeGreaterThan(0);

    const c = await newCustomer("T11");
    const id = await approvedOrder(c.ctx, [await line("rasmalai", 2)]);
    const kitchen = await staffLogin("kitchen");
    const t = await prisma.kitchenTicket.findUniqueOrThrow({ where: { orderId: id } });
    await kitchenTicketAction(kitchen.ctx, t.id, { action: "start" });
    await kitchenTicketAction(kitchen.ctx, t.id, { action: "ready" });
    await markServed((await staffLogin("service")).ctx, id);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    await recordPayment((await staffLogin("cashier")).ctx, { orderId: id, amountPaise: order.totalPaise, method: "CASH", idempotencyKey: randomUUID() });

    const after = await getAnalytics(range);
    expect(after.summary.acceptedOrders).toBeGreaterThan(before.summary.acceptedOrders);
    expect(after.summary.grossSalesPaise).toBeGreaterThanOrEqual(before.summary.grossSalesPaise + 30000);
    expect(after.timings.prepSamples).toBeGreaterThan(0);

    const liveOnly = await getAnalytics({ ...range, includeDemo: false });
    expect(liveOnly.summary.acceptedOrders).toBeLessThan(after.summary.acceptedOrders);

    const csv = await exportCsv("orders", range);
    expect(csv.split("\r\n")[0]).toBe("reference,submitted_at_utc,table,status,payment_status,subtotal,discount,tax,rounding,total,is_demo");
    expect(csv).toContain(order.reference);
  });
});

describe("dietary assistant (menu-grounded)", () => {
  it("answers from stored metadata and never lists unverified items as allergen-safe", async () => {
    const menu = await getPublicMenu("en");
    const res = answerAssistant("vegetarian, no nuts, under 300", menu, "en");
    expect(res.results.length).toBeGreaterThan(0);
    for (const r of res.results) {
      const item = menu.items.find((i) => i.id === r.itemId)!;
      expect(["VEG", "VEGAN"]).toContain(item.dietType);
      expect(item.pricePaise).toBeLessThanOrEqual(30000);
      expect(item.allergens.some((a) => a.key === "nuts")).toBe(false);
      expect(item.allergenInfoVerified).toBe(true);
    }
    // Crispy Corn is veg, nut-free on record, but unverified → routed to staff, not recommended.
    expect(res.needsStaffCheck.some((r) => r.name === "Crispy Corn")).toBe(true);
    expect(res.disclaimer).toMatch(/severe allergy/);
    const hi = answerAssistant("शाकाहारी", await getPublicMenu("hi"), "hi");
    expect(hi.results.length).toBeGreaterThan(0);
  });
});
