import { describe, expect, it } from "vitest";
import { calculatePricing, discountAmount, type PricingLineInput } from "@/lib/pricing/calculator";
import { allocateProportionally, applyBps, divRound, formatMoney } from "@/lib/pricing/money";

const GST5 = { taxCode: "GST5", taxName: "GST 5%", taxRateBps: 500, taxComponents: [{ name: "CGST", rateBps: 250 }, { name: "SGST", rateBps: 250 }] };
const line = (over: Partial<PricingLineInput>): PricingLineInput => ({ key: "0", menuItemId: "m1", name: "Dish", basePricePaise: 10000, quantity: 1, options: [], ...GST5, ...over });
const EXCL = { pricesIncludeTax: false, roundingMode: "NONE" as const };

describe("money helpers", () => {
  it("rounds half-up with exact integer arithmetic", () => {
    expect(applyBps(105, 500)).toBe(5); // 5.25 -> 5
    expect(applyBps(110, 500)).toBe(6); // 5.5 -> 6
    expect(applyBps(-110, 500)).toBe(-6);
    expect(divRound(250, 100)).toBe(3);
    expect(divRound(249, 100)).toBe(2);
    expect(() => applyBps(1.5, 500)).toThrow();
  });

  it("allocates proportionally and always sums exactly", () => {
    const parts = allocateProportionally(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportionally(7, [0, 0])).toEqual([0, 0]);
  });

  it("formats INR", () => {
    expect(formatMoney(123450)).toBe("₹1,234.50");
    expect(formatMoney(50000)).toBe("₹500");
  });
});

describe("calculatePricing", () => {
  it("adds options to unit price and computes exclusive tax per line", () => {
    const r = calculatePricing(
      [line({ quantity: 2, options: [{ groupId: "g", groupName: "Size", optionId: "o", optionName: "Large", priceDeltaPaise: 2550 }] })],
      EXCL,
    );
    expect(r.lines[0].unitPricePaise).toBe(12550);
    expect(r.subtotalPaise).toBe(25100);
    expect(r.taxPaise).toBe(1255);
    expect(r.totalPaise).toBe(26355);
    expect(r.taxBreakdown[0].components.map((c) => c.amountPaise)).toEqual([628, 627]);
  });

  it("extracts tax when prices include tax", () => {
    const r = calculatePricing([line({ basePricePaise: 10500 })], { pricesIncludeTax: true, roundingMode: "NONE" });
    expect(r.totalPaise).toBe(10500);
    expect(r.taxPaise).toBe(500);
    expect(r.taxBreakdown[0].taxablePaise).toBe(10000);
  });

  it("rounds the bill to the nearest rupee and records the rounding", () => {
    const r = calculatePricing([line({ basePricePaise: 45000 })], { pricesIncludeTax: false, roundingMode: "NEAREST_RUPEE" });
    expect(r.totalPaise).toBe(47300); // 450 + 22.50 = 472.50 -> 473
    expect(r.roundingPaise).toBe(50);
    const down = calculatePricing([line({ basePricePaise: 10040 })], { pricesIncludeTax: false, roundingMode: "NEAREST_RUPEE" });
    expect(down.totalPaise % 100).toBe(0);
    expect(down.roundingPaise).toBeLessThanOrEqual(0);
  });

  it("applies tax per tax category", () => {
    const r = calculatePricing([line({}), line({ key: "1", menuItemId: "m2", taxCode: "GST18", taxName: "GST 18%", taxRateBps: 1800, taxComponents: [] })], EXCL);
    expect(r.taxPaise).toBe(500 + 1800);
    expect(r.taxBreakdown.map((t) => t.code).sort()).toEqual(["GST18", "GST5"]);
  });

  it("allocates an order discount across lines before tax", () => {
    const r = calculatePricing([line({ basePricePaise: 30000 }), line({ key: "1", basePricePaise: 10000 })], EXCL, { type: "FIXED_OFF", valuePaise: 4000 });
    expect(r.discountPaise).toBe(4000);
    expect(r.lines.map((l) => l.lineDiscountPaise)).toEqual([3000, 1000]);
    expect(r.taxPaise).toBe(1800); // 5% of 36000
    expect(r.totalPaise).toBe(37800);
  });

  it("rejects invalid quantities and prices", () => {
    expect(() => calculatePricing([line({ quantity: 0 })], EXCL)).toThrow();
    expect(() => calculatePricing([line({ basePricePaise: -1 })], EXCL)).toThrow();
  });
});

describe("discount eligibility amounts", () => {
  const lines = [{ menuItemId: "chai", unitPricePaise: 6000, quantity: 2 }, { menuItemId: "dal", unitPricePaise: 26000, quantity: 1 }];
  it("caps percentage discounts", () => {
    expect(discountAmount({ type: "PERCENT_OFF", percentBps: 1000, maxDiscountPaise: 1500 }, lines, 38000)).toBe(1500);
    expect(discountAmount({ type: "PERCENT_OFF", percentBps: 1000 }, lines, 38000)).toBe(3800);
  });
  it("never discounts more than the subtotal", () => {
    expect(discountAmount({ type: "FIXED_OFF", valuePaise: 999999 }, lines, 38000)).toBe(38000);
  });
  it("gives one unit of the free item only when it is in the cart", () => {
    expect(discountAmount({ type: "FREE_ITEM", freeMenuItemId: "chai" }, lines, 38000)).toBe(6000);
    expect(discountAmount({ type: "FREE_ITEM", freeMenuItemId: "kulfi" }, lines, 38000)).toBe(0);
  });
});
