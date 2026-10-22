// Loyalty ledger. The balance on LoyaltyAccount is only ever changed together with an
// append-only LoyaltyLedgerEntry in the same transaction; a DB CHECK keeps it non-negative and
// unique dedupe keys make every award/redeem/reversal happen at most once.

import { prisma, type Tx } from "@/lib/db/prisma";
import type { LoyaltyEntryType } from "@/lib/generated/prisma/client";
import { conflict } from "@/lib/http/errors";
import { lockOrder } from "@/lib/db/locks";
import { getRestaurantConfig } from "@/lib/settings";
import { pointsForNetSales, isExpired } from "@/lib/loyalty/rules";
import { audit, type Actor, SYSTEM_ACTOR } from "@/lib/audit";
import type { CustomerContext } from "@/lib/auth/customer-session";

export async function ensureAccount(tx: Tx, customerId: string) {
  return tx.loyaltyAccount.upsert({ where: { customerId }, create: { customerId }, update: {} });
}

async function applyEntry(
  tx: Tx,
  accountId: string,
  delta: number,
  entry: { type: LoyaltyEntryType; orderId?: string; redemptionId?: string; reason?: string; actorId?: string | null; dedupeKey?: string },
) {
  const now = new Date();
  const updated = await tx.loyaltyAccount.updateMany({
    where: { id: accountId, ...(delta < 0 ? { balance: { gte: -delta } } : {}) },
    data: {
      balance: { increment: delta },
      ...(entry.type === "EARN" && { lifetimeEarned: { increment: delta }, lastEarnedAt: now }),
      ...(entry.type === "REDEEM" && { lifetimeRedeemed: { increment: -delta } }),
      ...(entry.type === "REDEEM_REVERSAL" && { lifetimeRedeemed: { decrement: delta } }),
    },
  });
  if (updated.count !== 1) throw conflict("INSUFFICIENT_POINTS", "Not enough loyalty points");
  const account = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: accountId } });
  return tx.loyaltyLedgerEntry.create({
    data: {
      accountId,
      type: entry.type,
      points: delta,
      balanceAfter: account.balance,
      orderId: entry.orderId,
      redemptionId: entry.redemptionId,
      reason: entry.reason,
      actorId: entry.actorId ?? null,
      dedupeKey: entry.dedupeKey,
    },
  });
}

/**
 * Award points for an order once it is both SERVED and fully PAID. Safe to call repeatedly
 * (from serving and from payment recording): only one EARN per earn-cycle can exist.
 */
export async function awardPointsIfEligible(tx: Tx, orderId: string, actor: Actor = SYSTEM_ACTOR) {
  const { settings } = await getRestaurantConfig(tx);
  if (!settings.loyaltyEnabled) return null;
  await lockOrder(tx, orderId);
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { adjustments: true, customer: true } });
  if (!order || order.status !== "SERVED" || order.paymentStatus !== "PAID" || order.customer.anonymizedAt) return null;

  // Sequential on purpose: a transaction uses a single connection.
  const earns = await tx.loyaltyLedgerEntry.count({ where: { orderId, type: "EARN" } });
  const reversals = await tx.loyaltyLedgerEntry.count({ where: { orderId, type: "EARN_REVERSAL" } });
  if (earns > reversals) return null; // points already held for this order

  const adjustmentDiscounts = order.adjustments
    .filter((a) => a.type === "DISCOUNT" || a.type === "CORRECTION")
    .reduce((s, a) => s + a.amountPaise, 0);
  const net = order.subtotalPaise - order.discountPaise - adjustmentDiscounts;
  const points = pointsForNetSales(net, settings.loyaltyPaisePerPoint);
  if (points <= 0) return null;

  const account = await ensureAccount(tx, order.customerId);
  const entry = await applyEntry(tx, account.id, points, {
    type: "EARN",
    orderId,
    reason: `Order ${order.reference}`,
    actorId: actor.id ?? null,
    dedupeKey: `earn:${orderId}:${reversals}`,
  });
  await audit(tx, { actor, action: "loyalty.earned", entityType: "LoyaltyAccount", entityId: account.id, after: { points, orderId } });
  return entry;
}

/** Remove points earned on an order (refund/void). Never drives the balance negative. */
export async function reverseEarnedPoints(tx: Tx, orderId: string, reason: string, actor: Actor) {
  const earns = await tx.loyaltyLedgerEntry.findMany({ where: { orderId, type: "EARN" }, orderBy: { createdAt: "asc" } });
  const reversals = await tx.loyaltyLedgerEntry.count({ where: { orderId, type: "EARN_REVERSAL" } });
  if (earns.length <= reversals) return null;
  const earned = earns[earns.length - 1];
  const account = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: earned.accountId } });
  const deduct = Math.min(earned.points, account.balance);
  const entry = await applyEntry(tx, account.id, -deduct, {
    type: "EARN_REVERSAL",
    orderId,
    reason: deduct < earned.points ? `${reason} (only ${deduct} of ${earned.points} points remained)` : reason,
    actorId: actor.id ?? null,
    dedupeKey: `earn-rev:${orderId}:${reversals}`,
  });
  await audit(tx, { actor, action: "loyalty.earn_reversed", entityType: "LoyaltyAccount", entityId: account.id, after: { points: -deduct, orderId, reason } });
  return entry;
}

export async function redeemRewardForOrder(
  tx: Tx,
  input: { customerId: string; rewardId: string; orderId: string; pointsCost: number; discountPaise: number },
) {
  const account = await ensureAccount(tx, input.customerId);
  const redemption = await tx.rewardRedemption.create({
    data: { rewardId: input.rewardId, accountId: account.id, orderId: input.orderId, pointsSpent: input.pointsCost, discountPaise: input.discountPaise },
  });
  await applyEntry(tx, account.id, -input.pointsCost, {
    type: "REDEEM",
    orderId: input.orderId,
    redemptionId: redemption.id,
    reason: "Reward redeemed",
    dedupeKey: `redeem:${input.orderId}`,
  });
  await audit(tx, {
    actor: { type: "CUSTOMER", id: input.customerId },
    action: "loyalty.redeemed",
    entityType: "RewardRedemption",
    entityId: redemption.id,
    after: { points: input.pointsCost, orderId: input.orderId },
  });
  return redemption;
}

/** Give points back when an order with a redemption is rejected/cancelled or the reward no longer applies. */
export async function reverseRedemptionForOrder(tx: Tx, orderId: string, actor: Actor, reason = "Order not completed") {
  const redemption = await tx.rewardRedemption.findUnique({ where: { orderId } });
  if (!redemption || redemption.status !== "APPLIED") return null;
  const res = await tx.rewardRedemption.updateMany({ where: { id: redemption.id, status: "APPLIED" }, data: { status: "REVERSED", reversedAt: new Date() } });
  if (res.count !== 1) return null;
  await applyEntry(tx, redemption.accountId, redemption.pointsSpent, {
    type: "REDEEM_REVERSAL",
    orderId,
    redemptionId: redemption.id,
    reason,
    actorId: actor.id ?? null,
    dedupeKey: `redeem-rev:${orderId}`,
  });
  await audit(tx, { actor, action: "loyalty.redemption_reversed", entityType: "RewardRedemption", entityId: redemption.id, after: { points: redemption.pointsSpent, reason } });
  return redemption;
}

/** Expire balances of accounts with no earning activity for `loyaltyExpiryDays`. */
export async function expireInactivePoints(now = new Date()) {
  const { settings } = await getRestaurantConfig();
  if (settings.loyaltyExpiryDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - settings.loyaltyExpiryDays * 86_400_000);
  const accounts = await prisma.loyaltyAccount.findMany({ where: { balance: { gt: 0 }, lastEarnedAt: { lt: cutoff } }, take: 500 });
  let expired = 0;
  for (const a of accounts) {
    if (!isExpired(a.lastEarnedAt, settings.loyaltyExpiryDays, now)) continue;
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: a.id } });
      if (fresh.balance <= 0) return;
      await applyEntry(tx, a.id, -fresh.balance, {
        type: "EXPIRE",
        reason: `No activity for ${settings.loyaltyExpiryDays} days`,
        dedupeKey: `expire:${a.id}:${a.lastEarnedAt?.toISOString()}`,
      });
    });
    expired++;
  }
  return expired;
}

export async function getCustomerLoyalty(customer: CustomerContext, lang: string) {
  const { settings } = await getRestaurantConfig();
  const rewards = await prisma.reward.findMany({ where: { isActive: true }, orderBy: [{ displayOrder: "asc" }, { pointsCost: "asc" }] });
  const pick = (base: string | null, i18n: unknown) => ((i18n as Record<string, string>)?.[lang] || base) ?? null;
  const rewardViews = rewards.map((r) => ({
    id: r.id,
    name: pick(r.name, r.nameI18n),
    description: pick(r.description, r.descriptionI18n),
    type: r.type,
    pointsCost: r.pointsCost,
    minOrderPaise: r.minOrderPaise,
    freeMenuItemId: r.freeMenuItemId,
    validTo: r.validTo,
  }));
  const rules = {
    enabled: settings.loyaltyEnabled,
    paisePerPoint: settings.loyaltyPaisePerPoint,
    minRedeemPoints: settings.loyaltyMinRedeemPoints,
    expiryDays: settings.loyaltyExpiryDays,
  };
  if (!customer.verified) return { verified: false as const, rules, rewards: rewardViews };
  const account = await prisma.loyaltyAccount.findUnique({
    where: { customerId: customer.customerId },
    include: { entries: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  return {
    verified: true as const,
    rules,
    rewards: rewardViews.map((r) => ({ ...r, affordable: (account?.balance ?? 0) >= r.pointsCost })),
    balance: account?.balance ?? 0,
    lifetimeEarned: account?.lifetimeEarned ?? 0,
    lifetimeRedeemed: account?.lifetimeRedeemed ?? 0,
    entries: (account?.entries ?? []).map((e) => ({ id: e.id, type: e.type, points: e.points, balanceAfter: e.balanceAfter, reason: e.reason, at: e.createdAt })),
  };
}
