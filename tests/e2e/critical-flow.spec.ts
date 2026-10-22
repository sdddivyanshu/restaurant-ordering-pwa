import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const DEMO_PASSWORD = "DemoPass2026!";

async function db<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

async function staffPage(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/staff/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"));
  return page;
}

test.describe.configure({ mode: "serial" });

test("QR → order → supervisor approval → kitchen → served → paid → history, receipt, analytics, feedback", async ({ page, browser }) => {
  // 1. Open a seeded table QR URL.
  const [{ qrToken }] = await db<{ qrToken: string }>(`SELECT "qrToken" FROM "RestaurantTable" WHERE label = 'T2'`);
  await page.goto(`/t/${qrToken}`);
  await expect(page.getByText("You're at Table 2")).toBeVisible();

  // 2. Register a customer.
  await page.getByLabel("Your name").fill("E2E Diner");
  await page.getByLabel("Mobile number").fill("9812345670");
  await page.getByText(/I agree to the privacy notice/).click();
  await page.getByRole("button", { name: "Start ordering" }).click();
  await page.waitForURL("**/menu");

  // 3–5. Browse, customise and add multiple items.
  await expect(page.getByRole("heading", { name: "Main Course" })).toBeVisible();
  await page.getByRole("button", { name: "Add Paneer Butter Masala" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByText("Large", { exact: true }).click();
  await sheet.getByText("Extra cheese").click();
  await sheet.getByRole("button", { name: /Add to cart · ₹440/ }).click();
  await page.getByRole("button", { name: "Add Tandoori Roti" }).click();
  await page.getByRole("button", { name: "Add Tandoori Roti" }).click();
  await page.getByRole("link", { name: /View cart/ }).click();

  // 6. Review and submit.
  await expect(page.getByTestId("order-total")).toHaveText("₹546"); // (440 + 80) × 1.05 = 546
  await page.getByRole("button", { name: /Review order/ }).click();
  await page.getByRole("button", { name: /Place order/ }).click();

  // 7. Pending approval.
  await page.waitForURL(/\/orders\//);
  await expect(page.getByTestId("order-status")).toHaveText(/awaiting approval/i);
  const orderId = page.url().split("/orders/")[1].split("?")[0];
  const [{ reference }] = await db<{ reference: string }>(`SELECT reference FROM "Order" WHERE id = $1`, [orderId]);

  // 8. Kitchen cannot see the pending order.
  const kitchen = await staffPage(browser, "kitchen@demo.restaurant.local");
  await kitchen.goto("/staff/kitchen");
  await expect(kitchen.getByRole("heading", { name: "Kitchen" })).toBeVisible();
  await expect(kitchen.getByTestId(`ticket-${reference}`)).toHaveCount(0);
  const board = await kitchen.request.get("/api/v1/kitchen/tickets");
  expect(JSON.stringify(await board.json())).not.toContain(reference);

  // 9–10. Supervisor approves.
  const supervisor = await staffPage(browser, "supervisor@demo.restaurant.local");
  await supervisor.goto("/staff/supervisor");
  const card = supervisor.getByTestId(`pending-${reference}`);
  await expect(card).toBeVisible();
  await card.getByTestId("approve-button").click();
  await expect(card).toHaveCount(0);

  // 11. Exactly one kitchen ticket (repeat approval is a no-op).
  const again = await supervisor.request.post(`/api/v1/supervisor/orders/${orderId}`, { data: { action: "approve", expectedVersion: 1 }, headers: { origin: new URL(supervisor.url()).origin } });
  expect((await again.json()).alreadyApproved).toBe(true);
  await expect.poll(async () => (await db(`SELECT id FROM "KitchenTicket" WHERE "orderId" = $1`, [orderId])).length, { timeout: 15_000 }).toBe(1);

  // Customer sees the order move to the kitchen.
  await expect(page.getByTestId("order-status")).toHaveText(/Sent to kitchen|Being prepared/, { timeout: 20_000 });

  // 12–14. Kitchen starts and completes preparation.
  await kitchen.reload();
  const ticket = kitchen.getByTestId(`ticket-${reference}`);
  await expect(ticket).toBeVisible({ timeout: 15_000 });
  await ticket.getByRole("button", { name: "START" }).click();
  await expect(ticket.getByRole("button", { name: "READY" })).toBeVisible();
  await ticket.getByRole("button", { name: "READY" }).click();
  await expect(page.getByTestId("order-status")).toHaveText(/Ready to serve/, { timeout: 20_000 });

  // 15. Service staff marks it served.
  const service = await staffPage(browser, "service@demo.restaurant.local");
  await service.goto("/staff/service");
  await service.getByTestId(`serve-${reference}`).click();
  await expect(page.getByTestId("order-status")).toHaveText(/Served/, { timeout: 20_000 });

  // 16. Cashier records payment.
  const cashier = await staffPage(browser, "cashier@demo.restaurant.local");
  await cashier.goto("/staff/cashier");
  await cashier.getByRole("button", { name: new RegExp(reference) }).click();
  await expect(cashier.getByTestId("bill-due")).toHaveText("₹546");
  await cashier.getByTestId("record-payment").click();
  await expect(cashier.getByText("Payment recorded.")).toBeVisible();
  const [paid] = await db<{ status: string; paymentStatus: string }>(`SELECT status, "paymentStatus" FROM "Order" WHERE id = $1`, [orderId]);
  expect(paid).toEqual({ status: "SERVED", paymentStatus: "PAID" });

  // 17. History, receipt and analytics.
  await page.goto("/orders");
  await expect(page.getByRole("link", { name: reference }).first()).toBeVisible();
  const receipt = await cashier.request.get(`/api/v1/cashier/bills/${orderId}/receipt`);
  expect(receipt.ok()).toBe(true);
  expect((await receipt.json()).receipt.number).toMatch(/^RCPT-/);
  const admin = await staffPage(browser, "admin@demo.restaurant.local");
  const analytics = await (await admin.request.get("/api/v1/admin/analytics?includeDemo=false")).json();
  expect(analytics.summary.acceptedOrders).toBeGreaterThanOrEqual(1);
  expect(analytics.summary.grossSalesPaise).toBeGreaterThanOrEqual(52000);

  // 18. Feedback stored.
  await page.goto(`/orders/${orderId}`);
  for (const group of ["Overall", "Food", "Service"]) await page.getByRole("radiogroup", { name: group }).getByRole("radio", { name: "5 / 5" }).click();
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText("Thank you for your feedback!")).toBeVisible();
  const fb = await db(`SELECT overall FROM "Feedback" WHERE "orderId" = $1`, [orderId]);
  expect(fb).toEqual([{ overall: 5 }]);

  // Loyalty awarded exactly once (net 520 → 52 points).
  const earn = await db<{ points: number }>(`SELECT points FROM "LoyaltyLedgerEntry" WHERE "orderId" = $1 AND type = 'EARN'`, [orderId]);
  expect(earn).toEqual([{ points: 52 }]);
});

test("negative: customer, kitchen and cashier cannot exceed their permissions; bad QR is refused", async ({ page, browser, request }) => {
  const bad = await request.post("/api/v1/public/qr", { data: { token: "not-a-real-table-token" } });
  expect(bad.status()).toBe(404);
  await page.goto("/t/not-a-real-table-token");
  await expect(page.getByText("We couldn't open this table")).toBeVisible();

  const [{ id: pendingId }] = await db<{ id: string }>(`SELECT id FROM "Order" WHERE status = 'PENDING_APPROVAL' LIMIT 1`);
  const anon = await request.post(`/api/v1/supervisor/orders/${pendingId}`, { data: { action: "approve", expectedVersion: 1 } });
  expect(anon.status()).toBe(401);

  const kitchen = await staffPage(browser, "kitchen@demo.restaurant.local");
  expect((await kitchen.request.get("/api/v1/admin/users")).status()).toBe(403);
  const cashier = await staffPage(browser, "cashier@demo.restaurant.local");
  const origin = new URL(cashier.url()).origin;
  const attempt = await cashier.request.post(`/api/v1/supervisor/orders/${pendingId}`, { data: { action: "approve", expectedVersion: 1 }, headers: { origin } });
  expect(attempt.status()).toBe(403);
  const [{ status }] = await db<{ status: string }>(`SELECT status FROM "Order" WHERE id = $1`, [pendingId]);
  expect(status).toBe("PENDING_APPROVAL");
});

export type { APIRequestContext };
