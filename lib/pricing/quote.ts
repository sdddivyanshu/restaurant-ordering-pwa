// Server-side cart quoting: loads authoritative menu data, validates every line and prices it
// with the shared calculator. Client-supplied prices and totals are never used.

import { prisma, type Tx } from "@/lib/db/prisma";
import type { CartLineInput } from "@/lib/validation/schemas";
import { calculatePricing, type DiscountSpec, type PricingLineInput, type PricingResult, type TaxComponent } from "@/lib/pricing/calculator";
import { validateSelections, type SelectionError } from "@/lib/menu/customization";
import { unavailableReason, type UnavailableReason } from "@/lib/menu/availability";
import { effectiveDiet, type DietTypeValue } from "@/lib/menu/diet";
import { checkRedemption } from "@/lib/loyalty/rules";
import { getRestaurantConfig } from "@/lib/settings";

export interface QuoteIssue {
  index: number;
  menuItemId: string;
  code: "NOT_FOUND" | UnavailableReason | "INVALID_CUSTOMIZATION";
  message: string;
  errors?: SelectionError[];
}

export interface QuoteLineDetail {
  index: number;
  menuItemId: string;
  name: string;
  nameI18n: Record<string, string>;
  imageUrl: string | null;
  dietType: DietTypeValue;
  allergens: string[];
  prepMinutes: number;
  notes: string | null;
  selections: { groupId: string; optionIds: string[] }[];
}

export interface Quote extends PricingResult {
  issues: QuoteIssue[];
  details: QuoteLineDetail[];
  reward: { id: string; name: string; pointsCost: number; discountPaise: number } | null;
  rewardError: { code: string; message: string } | null;
  estimatedPrepMinutes: number;
  currency: string;
}

const REASON_MESSAGES: Record<UnavailableReason, string> = {
  ARCHIVED: "This item is no longer on the menu",
  CATEGORY_INACTIVE: "This item is not currently offered",
  UNAVAILABLE: "This item is currently unavailable",
  OUT_OF_HOURS: "This item is not served at this time",
  OUT_OF_SEASON: "This item is out of season",
};

export async function quoteCart(
  db: Tx | typeof prisma,
  lines: CartLineInput[],
  opts: {
    rewardId?: string | null;
    customer?: { customerId: string; verified: boolean } | null;
    now?: Date;
    /** Re-quoting an order whose reward points were already spent: skip balance/verification checks. */
    existingRedemption?: boolean;
  } = {},
): Promise<Quote> {
  const now = opts.now ?? new Date();
  const { restaurant, settings } = await getRestaurantConfig(db);
  const ids = [...new Set(lines.map((l) => l.menuItemId))];
  const items = await db.menuItem.findMany({
    where: { id: { in: ids } },
    include: {
      category: true,
      taxConfig: true,
      translations: true,
      allergens: { include: { allergen: true } },
      customizationGroups: {
        include: { group: { include: { options: { where: { archivedAt: null }, orderBy: { displayOrder: "asc" } } } } },
        orderBy: { displayOrder: "asc" },
      },
    },
  });
  const byId = new Map(items.map((i) => [i.id, i]));

  const issues: QuoteIssue[] = [];
  const pricingInputs: PricingLineInput[] = [];
  const details: QuoteLineDetail[] = [];

  lines.forEach((line, index) => {
    const item = byId.get(line.menuItemId);
    if (!item) {
      issues.push({ index, menuItemId: line.menuItemId, code: "NOT_FOUND", message: "This item no longer exists" });
      return;
    }
    const reason = unavailableReason(item, now, restaurant.timezone);
    if (reason) {
      issues.push({ index, menuItemId: item.id, code: reason, message: REASON_MESSAGES[reason] });
      return;
    }
    const groups = item.customizationGroups.map((g) => g.group).filter((g) => !g.archivedAt);
    const selections: Record<string, string[]> = {};
    for (const s of line.selections) selections[s.groupId] = [...(selections[s.groupId] ?? []), ...s.optionIds];
    const errors = validateSelections(
      groups.map((g) => ({ id: g.id, name: g.name, isRequired: g.isRequired, minSelect: g.minSelect, maxSelect: g.maxSelect, options: g.options })),
      selections,
    );
    if (errors.length) {
      issues.push({ index, menuItemId: item.id, code: "INVALID_CUSTOMIZATION", message: errors[0].message, errors });
      return;
    }
    const chosen = groups.flatMap((g) =>
      (selections[g.id] ?? []).map((optionId) => {
        const o = g.options.find((x) => x.id === optionId)!;
        return { group: g, option: o };
      }),
    );
    pricingInputs.push({
      key: String(index),
      menuItemId: item.id,
      name: item.name,
      basePricePaise: item.basePricePaise,
      quantity: line.quantity,
      taxCode: item.taxConfig.code,
      taxName: item.taxConfig.name,
      taxRateBps: item.taxConfig.rateBps,
      taxComponents: (item.taxConfig.components as unknown as TaxComponent[]) ?? [],
      options: chosen.map(({ group, option }) => ({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        priceDeltaPaise: option.priceDeltaPaise,
      })),
    });
    const nameI18n: Record<string, string> = { en: item.name };
    for (const t of item.translations) nameI18n[t.locale] = t.name;
    details.push({
      index,
      menuItemId: item.id,
      name: item.name,
      nameI18n,
      imageUrl: item.imageUrl,
      dietType: effectiveDiet(item.dietType, chosen.map((c) => c.option.dietType)),
      allergens: [...new Set([...item.allergens.map((a) => a.allergen.key), ...chosen.flatMap((c) => c.option.allergenKeys)])],
      prepMinutes: item.prepMinutes,
      notes: line.notes?.trim() || null,
      selections: groups.map((g) => ({ groupId: g.id, optionIds: selections[g.id] ?? [] })).filter((s) => s.optionIds.length),
    });
  });

  // Reward (loyalty redemption) — validated entirely server-side.
  let discount: DiscountSpec | null = null;
  let rewardInfo: Quote["reward"] = null;
  let rewardError: Quote["rewardError"] = null;
  if (opts.rewardId) {
    const reward = await db.reward.findUnique({ where: { id: opts.rewardId } });
    if (!reward) rewardError = { code: "NOT_FOUND", message: "Reward not found" };
    else if (!opts.customer) rewardError = { code: "NOT_VERIFIED", message: "Verify your mobile number to redeem rewards" };
    else {
      const account = await db.loyaltyAccount.findUnique({ where: { customerId: opts.customer.customerId } });
      const preSubtotal = pricingInputs.reduce(
        (s, l) => s + (l.basePricePaise + l.options.reduce((a, o) => a + o.priceDeltaPaise, 0)) * l.quantity,
        0,
      );
      const check = checkRedemption({
        reward,
        balance: opts.existingRedemption ? Number.MAX_SAFE_INTEGER : account?.balance ?? 0,
        verified: opts.existingRedemption ? true : opts.customer.verified,
        minRedeemPoints: settings.loyaltyMinRedeemPoints,
        subtotalPaise: preSubtotal,
        cartMenuItemIds: pricingInputs.map((l) => l.menuItemId),
        now,
      });
      if (!settings.loyaltyEnabled) rewardError = { code: "DISABLED", message: "Rewards are currently disabled" };
      else if (!check.ok) rewardError = { code: check.code, message: check.message };
      else {
        discount = {
          type: reward.type,
          percentBps: reward.percentBps,
          valuePaise: reward.valuePaise,
          maxDiscountPaise: reward.maxDiscountPaise,
          freeMenuItemId: reward.freeMenuItemId,
          label: reward.name,
        };
        rewardInfo = { id: reward.id, name: reward.name, pointsCost: reward.pointsCost, discountPaise: 0 };
      }
    }
  }

  const priced = calculatePricing(pricingInputs, { pricesIncludeTax: settings.pricesIncludeTax, roundingMode: settings.roundingMode }, discount);
  if (rewardInfo) rewardInfo.discountPaise = priced.discountPaise;

  return {
    ...priced,
    issues,
    details,
    reward: rewardInfo,
    rewardError,
    estimatedPrepMinutes: details.reduce((m, d) => Math.max(m, d.prepMinutes), 0),
    currency: restaurant.currency,
  };
}

/** Shape returned to the browser — merges priced lines with their display details. */
export function serializeQuote(q: Quote) {
  const detailByIndex = new Map(q.details.map((d) => [String(d.index), d]));
  return {
    lines: q.lines.map((l) => {
      const d = detailByIndex.get(l.key)!;
      return {
        index: d.index,
        menuItemId: l.menuItemId,
        name: d.name,
        nameI18n: d.nameI18n,
        imageUrl: d.imageUrl,
        dietType: d.dietType,
        allergens: d.allergens,
        quantity: l.quantity,
        notes: d.notes,
        selections: d.selections,
        options: l.options.map((o) => ({ groupName: o.groupName, optionName: o.optionName, priceDeltaPaise: o.priceDeltaPaise })),
        unitPricePaise: l.unitPricePaise,
        lineSubtotalPaise: l.lineSubtotalPaise,
        lineDiscountPaise: l.lineDiscountPaise,
        lineTaxPaise: l.lineTaxPaise,
        lineTotalPaise: l.lineTotalPaise,
        taxRateBps: l.taxRateBps,
      };
    }),
    issues: q.issues,
    subtotalPaise: q.subtotalPaise,
    discountPaise: q.discountPaise,
    taxPaise: q.taxPaise,
    roundingPaise: q.roundingPaise,
    totalPaise: q.totalPaise,
    taxBreakdown: q.taxBreakdown,
    pricesIncludeTax: q.pricesIncludeTax,
    reward: q.reward,
    rewardError: q.rewardError,
    estimatedPrepMinutes: q.estimatedPrepMinutes,
    currency: q.currency,
  };
}

export type SerializedQuote = ReturnType<typeof serializeQuote>;
