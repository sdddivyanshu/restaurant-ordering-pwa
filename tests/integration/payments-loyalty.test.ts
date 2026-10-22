import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { addAdjustment, recordPayment, voidPayment } from "@/lib/payments/service";
import { markServed } from "@/lib/orders/serve";
import { kitchenTicketAction } from "@/lib/kitchen/service";
import { rejectOrder } from "@/lib/approvals/service";
import { requestOtp, verifyOtp } from "@/lib/customers/service";
import { getCustomerLoyalty } from "@/lib/loyalty/service";
import { approvedOrder, line, newCustomer, placeOrder, refreshCustomer, staffLogin } from "../helpers";

async function servedOrder(tableLabel = "T9") {
  const c = await newCustomer(tableLabel);
  const orderId = await approvedOrder(c.ctx, [await line("butter-chicken"), await line("naan", 2)]);
  const kitchen = await staffLogin("kitchen");
  const ticket = await prisma.kitchenTicket.findUniqueOrThrow({ where: { orderId } });
  await kitchenTicketAction(kitchen.ctx, ticket.id, { action: "start" });
  await kitchenTicketAction(kitchen.ctx, ticket.id, { action: "ready" });
  await markServed((await staffLogin("service")).ctx, orderId);
  return { c, orderId };
}

describe("payment recording", () => {
  it("supports partial payments, is idempotent per key and refuses overpayment", async () => {
    const { orderId } = await servedOrder();
    const cashier = await staffLogin("cashier");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const key = randomUUID();
    const half = Math.floor(order.totalPaise / 2);
    const [p1, p2] = await Promise.all([
      recordPayment(cashier.ctx, { orderId, amountPaise: half, method: "CASH", idempotencyKey: key }),
      recordPayment(cashier.ctx, { orderId, amountPaise: half, method: "CASH", idempotencyKey: key }),
    ]);
    expect(p1.payment.id).toBe(p2.payment.id);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe("PARTIALLY_PAID");
    expect(await prisma.loyaltyLedgerEntry.count({ where: { orderId } })).toBe(0); // not yet fully paid

    await expect(recordPayment(cashier.ctx, { orderId, amountPaise: order.totalPaise, method: "UPI_MANUAL", idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "OVERPAYMENT" });
    const p3 = await recordPayment(cashier.ctx, { orderId, amountPaise: order.totalPaise - half, method: "UPI_MANUAL", externalReference: "UPI-REF-1", idempotencyKey: randomUUID() });
    expect(p3.payment.providerVerified).toBe(false); // manual record — never claimed as gateway-verified
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.status).toBe("SERVED");
    await expect(recordPayment(cashier.ctx, { orderId, amountPaise: 100, method: "CASH", idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "ALREADY_PAID" });
    expect(await prisma.auditLog.count({ where: { action: "payment.recorded", after: { path: ["orderId"], equals: orderId } } })).toBe(2);
  });

  it("refuses payments on orders that are not approved", async () => {
    const c = await newCustomer("T9");
    const { order } = await placeOrder(c.ctx, [await line("jeera-rice")]);
    const cashier = await staffLogin("cashier");
    await expect(recordPayment(cashier.ctx, { orderId: order.id, amountPaise: 100, method: "CASH", idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "NOT_BILLABLE" });
  });

  it("applies authorised discounts and reverses loyalty points on refund", async () => {
    const { orderId } = await servedOrder();
    const cashier = await staffLogin("cashier");
    await addAdjustment(cashier.ctx, orderId, { type: "DISCOUNT", amountPaise: 5000, reason: "Delay compensation" });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await recordPayment(cashier.ctx, { orderId, amountPaise: order.totalPaise - 5000, method: "CASH", idempotencyKey: randomUUID() });
    const earn = await prisma.loyaltyLedgerEntry.findFirstOrThrow({ where: { orderId, type: "EARN" } });
    // Net = subtotal 500 − 50 discount = 450 → 45 points at ₹10/point.
    expect(earn.points).toBe(45);

    await addAdjustment(cashier.ctx, orderId, { type: "REFUND", amountPaise: 1000, reason: "Overcharged drink" });
    const rev = await prisma.loyaltyLedgerEntry.findMany({ where: { orderId, type: "EARN_REVERSAL" } });
    expect(rev).toHaveLength(1);
    expect(rev[0].points).toBe(-45);
    expect(await prisma.auditLog.count({ where: { action: "payment.adjustment.refund" } })).toBeGreaterThan(0);
  });

  it("voiding a payment reopens the bill and removes earned points; re-payment earns once again", async () => {
    const { orderId } = await servedOrder();
    const cashier = await staffLogin("cashier");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const { payment } = await recordPayment(cashier.ctx, { orderId, amountPaise: order.totalPaise, method: "CASH", idempotencyKey: randomUUID() });
    await voidPayment(cashier.ctx, payment.id, "Recorded against wrong table");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe("UNPAID");
    await expect(voidPayment(cashier.ctx, payment.id, "again")).rejects.toMatchObject({ code: "ALREADY_VOIDED" });
    await recordPayment(cashier.ctx, { orderId, amountPaise: order.totalPaise, method: "CASH", idempotencyKey: randomUUID() });
    const entries = await prisma.loyaltyLedgerEntry.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
    expect(entries.map((e) => e.type)).toEqual(["EARN", "EARN_REVERSAL", "EARN"]);
  });
});

describe("loyalty redemption", () => {
  it("requires a verified phone, deducts points atomically and restores them if the order is rejected", async () => {
    // Priya (seeded, verified elsewhere) has a 200-point opening balance; verify on this device via dev OTP.
    const c = await newCustomer("T10", "+919800000001");
    expect((await getCustomerLoyalty(c.ctx, "en")).verified).toBe(false);
    const reward = await prisma.reward.findFirstOrThrow({ where: { type: "PERCENT_OFF" } });
    const lines = [await line("butter-chicken"), await line("naan", 2)];
    await expect(placeOrder(c.ctx, lines, { rewardId: reward.id })).rejects.toMatchObject({ code: "REWARD_INVALID" });

    const otp = await requestOtp(c.ctx);
    expect(otp.mode).toBe("dev");
    await expect(verifyOtp(c.ctx, "000000" === otp.devCode ? "111111" : "000000")).rejects.toMatchObject({ code: "OTP_INVALID" });
    await verifyOtp(c.ctx, otp.devCode);
    const ctx = await refreshCustomer(c.token);
    expect(ctx.verified).toBe(true);

    const before = (await getCustomerLoyalty(ctx, "en")) as { balance: number };
    const { order } = await placeOrder(ctx, lines, { rewardId: reward.id });
    // 10% of 500 = 50 discount; tax applies to the discounted amount.
    expect(order.discountPaise).toBe(5000);
    expect(order.taxPaise).toBe(2250);
    const after = (await getCustomerLoyalty(ctx, "en")) as { balance: number };
    expect(after.balance).toBe(before.balance - reward.pointsCost);

    await rejectOrder((await staffLogin("supervisor")).ctx, order.id, "Kitchen closed");
    const restored = (await getCustomerLoyalty(ctx, "en")) as { balance: number };
    expect(restored.balance).toBe(before.balance);
    expect(await prisma.loyaltyLedgerEntry.count({ where: { orderId: order.id, type: "REDEEM_REVERSAL" } })).toBe(1);
  });

  it("never lets the balance go negative under concurrent redemptions", async () => {
    const c = await newCustomer("T10", "+919800000004"); // Vikram — verified demo customer, small balance
    const otp = await requestOtp(c.ctx);
    await verifyOtp(c.ctx, otp.devCode);
    const ctx = await refreshCustomer(c.token);
    const acct = await prisma.loyaltyAccount.upsert({ where: { customerId: ctx.customerId }, create: { customerId: ctx.customerId }, update: {} });
    await prisma.loyaltyAccount.update({ where: { id: acct.id }, data: { balance: 100 } });
    const reward = await prisma.reward.findFirstOrThrow({ where: { name: "Free Masala Chai" } }); // 60 points
    const lines = [await line("masala-chai"), await line("jeera-rice")];
    const results = await Promise.allSettled([placeOrder(ctx, lines, { rewardId: reward.id }), placeOrder(ctx, lines, { rewardId: reward.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: acct.id } })).balance).toBe(40);
  });
});
