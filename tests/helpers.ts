import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createStaffSession, resolveStaffSession } from "@/lib/auth/staff-session";
import { registerCustomer } from "@/lib/customers/service";
import { resolveCustomerSession, type CustomerContext } from "@/lib/auth/customer-session";
import { quoteCart } from "@/lib/pricing/quote";
import { submitOrder } from "@/lib/orders/submit";
import { approveOrder } from "@/lib/approvals/service";
import { processOutbox } from "@/lib/kitchen/outbox";
import type { CartLineInput } from "@/lib/validation/schemas";

export const EMAILS = {
  admin: "admin@demo.restaurant.local",
  supervisor: "supervisor@demo.restaurant.local",
  kitchen: "kitchen@demo.restaurant.local",
  cashier: "cashier@demo.restaurant.local",
  service: "service@demo.restaurant.local",
} as const;

export async function staffLogin(role: keyof typeof EMAILS) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAILS[role] } });
  const { token } = await createStaffSession(user.id);
  const ctx = await resolveStaffSession(token);
  if (!ctx) throw new Error("staff session failed");
  return { token, ctx };
}

let counter = 0;
export function uniquePhone() {
  counter += 1;
  return `+917${String(Date.now()).slice(-6)}${String(counter % 1000).padStart(3, "0")}`;
}

export async function qrTokenFor(label: string) {
  const t = await prisma.restaurantTable.findUniqueOrThrow({ where: { label } });
  return t.qrToken!;
}

export async function newCustomer(tableLabel = "T1", phone = uniquePhone(), deviceToken?: string) {
  const reg = await registerCustomer({ qrToken: await qrTokenFor(tableLabel), name: "Test Diner", phone, marketingConsent: false, language: "en" }, deviceToken);
  const res = await resolveCustomerSession(reg.sessionToken);
  if (!res.ok) throw new Error(`customer session failed: ${res.problem}`);
  return { token: reg.sessionToken, ctx: res.ctx, deviceToken: reg.deviceToken, phone };
}

export async function refreshCustomer(token: string): Promise<CustomerContext> {
  const res = await resolveCustomerSession(token);
  if (!res.ok) throw new Error(res.problem);
  return res.ctx;
}

/** Cart line for a menu item using default/first options for required groups, plus optional picks by option name. */
export async function line(slug: string, quantity = 1, picks: Record<string, string[]> = {}): Promise<CartLineInput> {
  const item = await prisma.menuItem.findUniqueOrThrow({
    where: { slug },
    include: { customizationGroups: { include: { group: { include: { options: { where: { archivedAt: null } } } } } } },
  });
  const selections = item.customizationGroups.map(({ group }) => {
    const picked = picks[group.key];
    if (picked) return { groupId: group.id, optionIds: picked.map((n) => group.options.find((o) => o.name === n)!.id) };
    const min = Math.max(group.minSelect, group.isRequired ? 1 : 0);
    const def = group.options.filter((o) => o.isDefault && o.isAvailable);
    const chosen = (def.length ? def : group.options.filter((o) => o.isAvailable)).slice(0, min);
    return { groupId: group.id, optionIds: chosen.map((o) => o.id) };
  });
  return { menuItemId: item.id, quantity, selections: selections.filter((s) => s.optionIds.length) };
}

export async function totalFor(ctx: CustomerContext, lines: CartLineInput[], rewardId?: string) {
  const q = await quoteCart(prisma, lines, { rewardId, customer: { customerId: ctx.customerId, verified: ctx.verified } });
  return q.totalPaise;
}

export async function placeOrder(ctx: CustomerContext, lines: CartLineInput[], opts: { rewardId?: string; idempotencyKey?: string } = {}) {
  return submitOrder(ctx, {
    lines,
    rewardId: opts.rewardId,
    expectedTotalPaise: await totalFor(ctx, lines, opts.rewardId),
    idempotencyKey: opts.idempotencyKey ?? randomUUID(),
  });
}

/** Submit + approve + dispatch, returning the order id. */
export async function approvedOrder(ctx: CustomerContext, lines?: CartLineInput[]) {
  const { order } = await placeOrder(ctx, lines ?? [await line("dal-makhani"), await line("naan", 2)]);
  const sup = await staffLogin("supervisor");
  await approveOrder(sup.ctx, order.id, order.version);
  await processOutbox();
  return order.id;
}

export function apiRequest(
  url: string,
  opts: { method?: string; body?: unknown; cookies?: Record<string, string>; origin?: string | null; contentType?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = opts.contentType ?? "application/json";
  if (opts.origin !== null) headers.origin = opts.origin ?? "http://localhost:3000";
  if (opts.cookies) headers.cookie = Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    headers,
  });
}

export const routeParams = (p: Record<string, string> = {}) => ({ params: Promise.resolve(p) });
