// Route-level negative tests: these call the real Next.js route handlers with cookies, so the
// server-side session, RBAC and CSRF checks are exercised exactly as in production.
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import * as supervisorOrder from "@/app/api/v1/supervisor/orders/[id]/route";
import * as adminUsers from "@/app/api/v1/admin/users/route";
import * as adminItem from "@/app/api/v1/admin/menu/items/[id]/route";
import * as adminSettings from "@/app/api/v1/admin/settings/route";
import * as kitchenTickets from "@/app/api/v1/kitchen/tickets/route";
import * as kitchenTicket from "@/app/api/v1/kitchen/tickets/[id]/route";
import * as customerOrder from "@/app/api/v1/customer/orders/[id]/route";
import * as customerOrders from "@/app/api/v1/customer/orders/route";
import * as cashierPayments from "@/app/api/v1/cashier/payments/route";
import * as serveRoute from "@/app/api/v1/service/orders/[id]/serve/route";
import * as qrRoute from "@/app/api/v1/public/qr/route";
import { COOKIE_CUSTOMER, COOKIE_STAFF } from "@/lib/auth/cookies";
import { getItemForEdit } from "@/lib/admin/menu";
import { apiRequest, approvedOrder, line, newCustomer, placeOrder, routeParams, staffLogin, totalFor } from "../helpers";

const staffCookie = (token: string) => ({ [COOKIE_STAFF]: token });
const custCookie = (token: string) => ({ [COOKIE_CUSTOMER]: token });

async function approveVia(cookies: Record<string, string>, orderId: string) {
  return supervisorOrder.POST(apiRequest(`/api/v1/supervisor/orders/${orderId}`, { body: { action: "approve", expectedVersion: 1 }, cookies }), routeParams({ id: orderId }));
}

describe("approval permissions", () => {
  it("customer cannot approve (no staff session)", async () => {
    const c = await newCustomer("T6");
    const { order } = await placeOrder(c.ctx, [await line("jeera-rice")]);
    const res = await approveVia(custCookie(c.token), order.id);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("SESSION_EXPIRED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_APPROVAL");
  });

  it("cashier and kitchen cannot approve; supervisor can", async () => {
    const c = await newCustomer("T6");
    const { order } = await placeOrder(c.ctx, [await line("jeera-rice")]);
    const cashier = await staffLogin("cashier");
    const kitchen = await staffLogin("kitchen");
    const service = await staffLogin("service");
    for (const s of [cashier, kitchen, service]) {
      const res = await approveVia(staffCookie(s.token), order.id);
      expect(res.status).toBe(403);
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_APPROVAL");
    const sup = await staffLogin("supervisor");
    const ok = await approveVia(staffCookie(sup.token), order.id);
    expect(ok.status).toBe(200);
  });

  it("a cashier explicitly granted order.approve + order.view can approve", async () => {
    const c = await newCustomer("T6");
    const { order } = await placeOrder(c.ctx, [await line("jeera-rice")]);
    const cashierUser = await prisma.user.findUniqueOrThrow({ where: { email: "cashier@demo.restaurant.local" } });
    const perms = await prisma.permission.findMany({ where: { key: { in: ["order.approve", "order.view"] } } });
    await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: cashierUser.id, permissionId: p.id })) });
    try {
      const cashier = await staffLogin("cashier");
      const res = await approveVia(staffCookie(cashier.token), order.id);
      expect(res.status).toBe(200);
    } finally {
      await prisma.userPermission.deleteMany({ where: { userId: cashierUser.id } });
    }
  });
});

describe("admin and kitchen boundaries", () => {
  it("kitchen staff cannot access admin endpoints", async () => {
    const kitchen = await staffLogin("kitchen");
    const users = await adminUsers.GET(apiRequest("/api/v1/admin/users", { cookies: staffCookie(kitchen.token) }), routeParams());
    expect(users.status).toBe(403);
    const settings = await adminSettings.GET(apiRequest("/api/v1/admin/settings", { cookies: staffCookie(kitchen.token) }), routeParams());
    expect(settings.status).toBe(403);
    const board = await kitchenTickets.GET(apiRequest("/api/v1/kitchen/tickets", { cookies: staffCookie(kitchen.token) }), routeParams());
    expect(board.status).toBe(200);
  });

  it("supervisor cannot modify menu prices (menu.manage required)", async () => {
    const sup = await staffLogin("supervisor");
    const item = await prisma.menuItem.findUniqueOrThrow({ where: { slug: "butter-chicken" } });
    const edit = await getItemForEdit(item.id);
    const body = {
      name: edit.name,
      categoryId: edit.categoryId,
      basePricePaise: 100,
      taxConfigId: edit.taxConfigId,
      dietType: edit.dietType,
    };
    const res = await adminItem.PATCH(apiRequest(`/api/v1/admin/menu/items/${item.id}`, { method: "PATCH", body, cookies: staffCookie(sup.token) }), routeParams({ id: item.id }));
    expect(res.status).toBe(403);
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: item.id } })).basePricePaise).toBe(38000);
  });

  it("kitchen cannot skip states (invalid transition is rejected)", async () => {
    const c = await newCustomer("T6");
    const orderId = await approvedOrder(c.ctx);
    const ticket = await prisma.kitchenTicket.findUniqueOrThrow({ where: { orderId } });
    const kitchen = await staffLogin("kitchen");
    const res = await kitchenTicket.POST(apiRequest(`/api/v1/kitchen/tickets/${ticket.id}`, { body: { action: "ready" }, cookies: staffCookie(kitchen.token) }), routeParams({ id: ticket.id }));
    expect(res.status).toBe(409);
  });

  it("kitchen staff cannot mark orders served or record payments", async () => {
    const c = await newCustomer("T6");
    const orderId = await approvedOrder(c.ctx);
    const kitchen = await staffLogin("kitchen");
    const serve = await serveRoute.POST(apiRequest(`/api/v1/service/orders/${orderId}/serve`, { method: "POST", cookies: staffCookie(kitchen.token) }), routeParams({ id: orderId }));
    expect(serve.status).toBe(403);
    const pay = await cashierPayments.POST(
      apiRequest("/api/v1/cashier/payments", { body: { orderId, amountPaise: 100, method: "CASH", idempotencyKey: "kitchen-attempt-1" }, cookies: staffCookie(kitchen.token) }),
      routeParams(),
    );
    expect(pay.status).toBe(403);
  });
});

describe("customer isolation (IDOR)", () => {
  it("a customer cannot read another customer's order, even at the same table", async () => {
    const a = await newCustomer("T7");
    const b = await newCustomer("T7");
    const { order } = await placeOrder(a.ctx, [await line("gulab-jamun")]);
    const own = await customerOrder.GET(apiRequest(`/api/v1/customer/orders/${order.id}`, { cookies: custCookie(a.token) }), routeParams({ id: order.id }));
    expect(own.status).toBe(200);
    const other = await customerOrder.GET(apiRequest(`/api/v1/customer/orders/${order.id}`, { cookies: custCookie(b.token) }), routeParams({ id: order.id }));
    expect(other.status).toBe(404);
    const anon = await customerOrder.GET(apiRequest(`/api/v1/customer/orders/${order.id}`), routeParams({ id: order.id }));
    expect(anon.status).toBe(401);
  });

  it("typing someone else's phone number on another device does not reveal their history", async () => {
    const a = await newCustomer("T7");
    await placeOrder(a.ctx, [await line("rasmalai")]);
    const impostor = await newCustomer("T8", a.phone); // same number, new device, unverified
    const { listOrderHistory } = await import("@/lib/orders/history");
    const history = await listOrderHistory(impostor.ctx);
    expect(history.rows).toHaveLength(0);
  });

  it("the customer API returns only masked data and no staff identities", async () => {
    const a = await newCustomer("T7");
    const id = await approvedOrder(a.ctx);
    const res = await customerOrder.GET(apiRequest(`/api/v1/customer/orders/${id}`, { cookies: custCookie(a.token) }), routeParams({ id }));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(a.phone);
    expect(text).not.toContain("approvedById");
    expect(text).not.toContain("Sunil");
  });
});

describe("request hardening", () => {
  it("rejects cross-origin state-changing requests (CSRF)", async () => {
    const c = await newCustomer("T8");
    const lines = [await line("jeera-rice")];
    const res = await customerOrders.POST(
      apiRequest("/api/v1/customer/orders", {
        body: { lines, expectedTotalPaise: await totalFor(c.ctx, lines), idempotencyKey: "csrf-attempt-123" },
        cookies: custCookie(c.token),
        origin: "https://evil.example",
      }),
      routeParams(),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_REJECTED");
  });

  it("rejects non-JSON bodies and validates input with a consistent error format", async () => {
    const res = await qrRoute.POST(apiRequest("/api/v1/public/qr", { body: { token: "x" }, contentType: "text/plain" }), routeParams());
    expect(res.status).toBe(415);
    const bad = await qrRoute.POST(apiRequest("/api/v1/public/qr", { body: { token: 5 } }), routeParams());
    expect(bad.status).toBe(400);
    const json = await bad.json();
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(json.error.details)).toBe(true);
  });

  it("invalid or revoked QR tokens return 404 with a friendly message", async () => {
    const res = await qrRoute.POST(apiRequest("/api/v1/public/qr", { body: { token: "definitely-not-a-valid-token" } }), routeParams());
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("QR_INVALID");
  });
});
