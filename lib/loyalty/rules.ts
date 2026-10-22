// Loyalty business rules (pure). Documented in docs/loyalty.md.
//
// EARN: points = floor(net sales / paisePerPoint), where net sales = order subtotal − order
//       discount − post-bill discount adjustments (tax excluded). Awarded once per order, only
//       when the order is SERVED *and* fully PAID.
// REVERSE: a refund or void after earning reverses all points earned on that order.
// REDEEM: requires a phone-verified session, an active reward, balance ≥ cost, cost ≥ the
//       restaurant minimum, and the reward's minimum order value.

export interface RewardRule {
  isActive: boolean;
  pointsCost: number;
  minOrderPaise: number;
  validFrom?: Date | null;
  validTo?: Date | null;
  type: "PERCENT_OFF" | "FIXED_OFF" | "FREE_ITEM";
  freeMenuItemId?: string | null;
}

export function pointsForNetSales(netSalesPaise: number, paisePerPoint: number): number {
  if (paisePerPoint <= 0 || netSalesPaise <= 0) return 0;
  return Math.floor(netSalesPaise / paisePerPoint);
}

export type RedemptionCheck =
  | { ok: true }
  | { ok: false; code: "NOT_VERIFIED" | "INACTIVE" | "NOT_YET_VALID" | "EXPIRED" | "INSUFFICIENT_POINTS" | "BELOW_MIN_ORDER" | "BELOW_MIN_REDEEM" | "ITEM_NOT_IN_CART"; message: string };

export function checkRedemption(input: {
  reward: RewardRule;
  balance: number;
  verified: boolean;
  minRedeemPoints: number;
  subtotalPaise: number;
  cartMenuItemIds: string[];
  now?: Date;
}): RedemptionCheck {
  const now = input.now ?? new Date();
  const r = input.reward;
  if (!input.verified) return { ok: false, code: "NOT_VERIFIED", message: "Verify your mobile number to redeem rewards" };
  if (!r.isActive) return { ok: false, code: "INACTIVE", message: "This reward is not available" };
  if (r.validFrom && r.validFrom > now) return { ok: false, code: "NOT_YET_VALID", message: "This reward is not active yet" };
  if (r.validTo && r.validTo < now) return { ok: false, code: "EXPIRED", message: "This reward has expired" };
  if (r.pointsCost < input.minRedeemPoints)
    return { ok: false, code: "BELOW_MIN_REDEEM", message: `Rewards must cost at least ${input.minRedeemPoints} points` };
  if (input.balance < r.pointsCost) return { ok: false, code: "INSUFFICIENT_POINTS", message: "Not enough points" };
  if (input.subtotalPaise < r.minOrderPaise) return { ok: false, code: "BELOW_MIN_ORDER", message: "Order value is below this reward's minimum" };
  if (r.type === "FREE_ITEM" && (!r.freeMenuItemId || !input.cartMenuItemIds.includes(r.freeMenuItemId)))
    return { ok: false, code: "ITEM_NOT_IN_CART", message: "Add the free item to your cart to use this reward" };
  return { ok: true };
}

/** Whether points expire for an account that last earned at `lastEarnedAt`. */
export function isExpired(lastEarnedAt: Date | null, expiryDays: number, now = new Date()): boolean {
  if (!lastEarnedAt || expiryDays <= 0) return false;
  return now.getTime() - lastEarnedAt.getTime() > expiryDays * 86_400_000;
}
