// The single pricing + tax engine used for quotes, order submission and change requests.
// Pure and deterministic: identical input always yields identical totals.

import { allocateProportionally, applyBps, divRound } from "@/lib/pricing/money";

export type RoundingMode = "NONE" | "NEAREST_RUPEE";

export interface TaxComponent {
  name: string;
  rateBps: number;
}

export interface PricingOption {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDeltaPaise: number;
}

export interface PricingLineInput {
  key: string;
  menuItemId: string;
  name: string;
  basePricePaise: number;
  quantity: number;
  taxCode: string;
  taxName: string;
  taxRateBps: number;
  taxComponents: TaxComponent[];
  options: PricingOption[];
}

export interface PricingConfig {
  pricesIncludeTax: boolean;
  roundingMode: RoundingMode;
}

export interface DiscountSpec {
  type: "PERCENT_OFF" | "FIXED_OFF" | "FREE_ITEM";
  percentBps?: number | null;
  valuePaise?: number | null;
  maxDiscountPaise?: number | null;
  freeMenuItemId?: string | null;
  label?: string;
}

export interface PricedLine extends PricingLineInput {
  unitOptionsPaise: number;
  unitPricePaise: number;
  lineSubtotalPaise: number;
  lineDiscountPaise: number;
  lineTaxPaise: number;
  lineTotalPaise: number;
}

export interface TaxBreakdownEntry {
  code: string;
  name: string;
  rateBps: number;
  taxablePaise: number;
  taxPaise: number;
  components: { name: string; rateBps: number; amountPaise: number }[];
}

export interface PricingResult {
  lines: PricedLine[];
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  roundingPaise: number;
  totalPaise: number;
  taxBreakdown: TaxBreakdownEntry[];
  pricesIncludeTax: boolean;
}

export function unitPrice(line: Pick<PricingLineInput, "basePricePaise" | "options">) {
  const unitOptionsPaise = line.options.reduce((s, o) => s + o.priceDeltaPaise, 0);
  return { unitOptionsPaise, unitPricePaise: line.basePricePaise + unitOptionsPaise };
}

/** Discount amount for a reward against priced lines (before tax). Never exceeds the subtotal. */
export function discountAmount(spec: DiscountSpec | null | undefined, lines: { menuItemId: string; unitPricePaise: number; quantity: number }[], subtotalPaise: number): number {
  if (!spec || subtotalPaise <= 0) return 0;
  let amount = 0;
  if (spec.type === "PERCENT_OFF") {
    amount = applyBps(subtotalPaise, spec.percentBps ?? 0);
    if (spec.maxDiscountPaise != null) amount = Math.min(amount, spec.maxDiscountPaise);
  } else if (spec.type === "FIXED_OFF") {
    amount = spec.valuePaise ?? 0;
  } else if (spec.type === "FREE_ITEM") {
    const match = lines.filter((l) => l.menuItemId === spec.freeMenuItemId && l.quantity > 0);
    // One unit of the cheapest matching configuration is free.
    amount = match.length ? Math.min(...match.map((l) => l.unitPricePaise)) : 0;
  }
  return Math.max(0, Math.min(amount, subtotalPaise));
}

function splitComponents(taxPaise: number, rateBps: number, components: TaxComponent[]) {
  if (!components.length) return [];
  const parts = allocateProportionally(taxPaise, components.map((c) => c.rateBps || 0));
  if (rateBps === 0) return components.map((c) => ({ ...c, amountPaise: 0 }));
  return components.map((c, i) => ({ name: c.name, rateBps: c.rateBps, amountPaise: parts[i] }));
}

export function calculatePricing(inputs: PricingLineInput[], config: PricingConfig, discount?: DiscountSpec | null): PricingResult {
  for (const l of inputs) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new Error(`Invalid quantity for ${l.name}`);
    if (!Number.isInteger(l.basePricePaise) || l.basePricePaise < 0) throw new Error(`Invalid price for ${l.name}`);
  }
  const base = inputs.map((l) => {
    const u = unitPrice(l);
    return { ...l, ...u, lineSubtotalPaise: u.unitPricePaise * l.quantity };
  });
  const subtotalPaise = base.reduce((s, l) => s + l.lineSubtotalPaise, 0);
  const discountPaise = discountAmount(discount, base, subtotalPaise);
  const lineDiscounts = allocateProportionally(discountPaise, base.map((l) => l.lineSubtotalPaise));

  const lines: PricedLine[] = base.map((l, i) => {
    const net = l.lineSubtotalPaise - lineDiscounts[i];
    let tax: number;
    let total: number;
    if (config.pricesIncludeTax) {
      // Price already contains tax: extract it. taxable = net * 10000 / (10000 + rate).
      const taxable = divRound(net * 10000, 10000 + l.taxRateBps);
      tax = net - taxable;
      total = net;
    } else {
      tax = applyBps(net, l.taxRateBps);
      total = net + tax;
    }
    return { ...l, lineDiscountPaise: lineDiscounts[i], lineTaxPaise: tax, lineTotalPaise: total };
  });

  const byCode = new Map<string, TaxBreakdownEntry & { _components: TaxComponent[] }>();
  for (const l of lines) {
    const entry =
      byCode.get(l.taxCode) ??
      ({ code: l.taxCode, name: l.taxName, rateBps: l.taxRateBps, taxablePaise: 0, taxPaise: 0, components: [], _components: l.taxComponents } as TaxBreakdownEntry & { _components: TaxComponent[] });
    entry.taxablePaise += l.lineTotalPaise - l.lineTaxPaise;
    entry.taxPaise += l.lineTaxPaise;
    byCode.set(l.taxCode, entry);
  }
  const taxBreakdown: TaxBreakdownEntry[] = [...byCode.values()].map(({ _components, ...e }) => ({
    ...e,
    components: splitComponents(e.taxPaise, e.rateBps, _components),
  }));

  const taxPaise = lines.reduce((s, l) => s + l.lineTaxPaise, 0);
  const preRound = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  const rounded = config.roundingMode === "NEAREST_RUPEE" ? divRound(preRound, 100) * 100 : preRound;
  return {
    lines,
    subtotalPaise,
    discountPaise,
    taxPaise,
    roundingPaise: rounded - preRound,
    totalPaise: rounded,
    taxBreakdown,
    pricesIncludeTax: config.pricesIncludeTax,
  };
}
