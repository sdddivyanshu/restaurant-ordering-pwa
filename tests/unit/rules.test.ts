import { describe, expect, it } from "vitest";
import { validateSelections, defaultSelections, type GroupRule } from "@/lib/menu/customization";
import { assertTransition, canTransition, KITCHEN_VISIBLE_STATUSES, ORDER_STATUSES, TRANSITION_RULES, TransitionError } from "@/lib/orders/state-machine";
import { hasPermission, homePathFor, ROLE_PERMISSIONS, PERMISSIONS } from "@/lib/authorization/permissions";
import { checkRedemption, isExpired, pointsForNetSales } from "@/lib/loyalty/rules";
import { summarizeBill } from "@/lib/payments/bill";
import { maskPhone, normalizePhone } from "@/lib/security/phone";
import { inDailyWindow, unavailableReason } from "@/lib/menu/availability";
import { effectiveDiet } from "@/lib/menu/diet";
import { buildReorderLines } from "@/lib/orders/history";
import { csvCell, toCsv } from "@/lib/analytics/service";
import { parseAssistantQuery } from "@/lib/menu/assistant";
import { translate } from "@/lib/i18n";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

describe("customization validation", () => {
  const groups: GroupRule[] = [
    { id: "size", name: "Size", isRequired: true, minSelect: 1, maxSelect: 1, options: [{ id: "reg", isAvailable: true }, { id: "lg", isAvailable: true }] },
    { id: "add", name: "Add-ons", isRequired: false, minSelect: 0, maxSelect: 2, options: [{ id: "a", isAvailable: true }, { id: "b", isAvailable: true }, { id: "c", isAvailable: false }] },
  ];
  it("accepts a valid selection", () => expect(validateSelections(groups, { size: ["lg"], add: ["a", "b"] })).toEqual([]));
  it("requires required groups", () => expect(validateSelections(groups, {}).map((e) => e.code)).toEqual(["TOO_FEW"]));
  it("enforces max, availability, duplicates and unknowns", () => {
    expect(validateSelections(groups, { size: ["reg"], add: ["a", "b", "c"] }).map((e) => e.code).sort()).toEqual(["OPTION_UNAVAILABLE", "TOO_MANY"]);
    expect(validateSelections(groups, { size: ["reg", "reg"] }).some((e) => e.code === "DUPLICATE_OPTION")).toBe(true);
    expect(validateSelections(groups, { size: ["zzz"] }).some((e) => e.code === "UNKNOWN_OPTION")).toBe(true);
    expect(validateSelections(groups, { size: ["reg"], other: ["x"] }).some((e) => e.code === "UNKNOWN_GROUP")).toBe(true);
  });
  it("defaults to the first available option for required single-choice groups", () => {
    expect(defaultSelections(groups)).toEqual({ size: ["reg"], add: [] });
  });
});

describe("order state machine", () => {
  const perms = (...p: string[]) => new Set(p);
  it("allows the documented happy path", () => {
    const path = ["PENDING_APPROVAL", "APPROVED", "QUEUED", "PREPARING", "READY", "SERVED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it("rejects invalid transitions", () => {
    expect(canTransition("PENDING_APPROVAL", "QUEUED")).toBe(false);
    expect(canTransition("PENDING_APPROVAL", "PREPARING")).toBe(false);
    expect(canTransition("REJECTED", "APPROVED")).toBe(false);
    expect(canTransition("SERVED", "CANCELLED")).toBe(false);
    expect(canTransition("CUSTOMER_CONFIRMATION_REQUIRED", "APPROVED")).toBe(false);
    expect(() => assertTransition("QUEUED", "SERVED", perms(PERMISSIONS.ORDER_SERVE))).toThrow(TransitionError);
  });
  it("enforces who may perform each transition", () => {
    expect(() => assertTransition("PENDING_APPROVAL", "APPROVED", "CUSTOMER")).toThrow(/Not allowed/);
    expect(() => assertTransition("PENDING_APPROVAL", "APPROVED", perms(...ROLE_PERMISSIONS.CASHIER))).toThrow(/Not allowed/);
    expect(() => assertTransition("PENDING_APPROVAL", "APPROVED", perms(...ROLE_PERMISSIONS.KITCHEN))).toThrow(/Not allowed/);
    expect(() => assertTransition("PENDING_APPROVAL", "APPROVED", perms(...ROLE_PERMISSIONS.SUPERVISOR))).not.toThrow();
    expect(() => assertTransition("APPROVED", "QUEUED", perms(...ROLE_PERMISSIONS.ADMIN))).toThrow(); // system only
    expect(() => assertTransition("APPROVED", "QUEUED", "SYSTEM")).not.toThrow();
    expect(() => assertTransition("PENDING_APPROVAL", "CANCELLED", "CUSTOMER")).not.toThrow();
    expect(() => assertTransition("QUEUED", "CANCELLED", "CUSTOMER")).toThrow();
  });
  it("never exposes pre-approval states to the kitchen", () => {
    expect(KITCHEN_VISIBLE_STATUSES).not.toContain("PENDING_APPROVAL");
    expect(KITCHEN_VISIBLE_STATUSES).not.toContain("CHANGE_REQUESTED");
    expect(KITCHEN_VISIBLE_STATUSES).not.toContain("APPROVED");
    // The only way into QUEUED is APPROVED (via the system dispatcher).
    expect(TRANSITION_RULES.filter((r) => r.to === "QUEUED").map((r) => r.from)).toEqual(["APPROVED"]);
    expect(TRANSITION_RULES.filter((r) => r.to === "APPROVED").map((r) => r.from)).toEqual(["PENDING_APPROVAL"]);
  });
  it("has no dead-end non-terminal states", () => {
    for (const s of ORDER_STATUSES) {
      if (["SERVED", "REJECTED", "CANCELLED"].includes(s)) continue;
      expect(TRANSITION_RULES.some((r) => r.from === s)).toBe(true);
    }
  });
});

describe("permissions", () => {
  it("gives each role only what it needs", () => {
    expect(hasPermission(ROLE_PERMISSIONS.KITCHEN, PERMISSIONS.MENU_MANAGE)).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.KITCHEN, PERMISSIONS.CUSTOMER_PII_VIEW)).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.CASHIER, PERMISSIONS.ORDER_APPROVE)).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.SERVICE, PERMISSIONS.ORDER_APPROVE)).toBe(false);
    expect(hasPermission(ROLE_PERMISSIONS.SUPERVISOR, PERMISSIONS.ORDER_APPROVE)).toBe(true);
    expect(hasPermission(ROLE_PERMISSIONS.SUPERVISOR, PERMISSIONS.MENU_MANAGE)).toBe(false);
    expect(Object.values(PERMISSIONS).every((p) => hasPermission(ROLE_PERMISSIONS.ADMIN, p))).toBe(true);
  });
  it("routes staff to their home screen", () => {
    expect(homePathFor(ROLE_PERMISSIONS.KITCHEN)).toBe("/staff/kitchen");
    expect(homePathFor(ROLE_PERMISSIONS.CASHIER)).toBe("/staff/cashier");
    expect(homePathFor(ROLE_PERMISSIONS.ADMIN)).toBe("/admin");
  });
});

describe("loyalty rules", () => {
  const reward = { isActive: true, pointsCost: 100, minOrderPaise: 50000, type: "FIXED_OFF" as const };
  it("calculates points from net sales", () => {
    expect(pointsForNetSales(45000, 1000)).toBe(45);
    expect(pointsForNetSales(999, 1000)).toBe(0);
    expect(pointsForNetSales(-5, 1000)).toBe(0);
  });
  it("validates redemption eligibility", () => {
    const base = { reward, balance: 150, verified: true, minRedeemPoints: 50, subtotalPaise: 60000, cartMenuItemIds: [] };
    expect(checkRedemption(base)).toEqual({ ok: true });
    expect(checkRedemption({ ...base, verified: false })).toMatchObject({ code: "NOT_VERIFIED" });
    expect(checkRedemption({ ...base, balance: 99 })).toMatchObject({ code: "INSUFFICIENT_POINTS" });
    expect(checkRedemption({ ...base, subtotalPaise: 40000 })).toMatchObject({ code: "BELOW_MIN_ORDER" });
    expect(checkRedemption({ ...base, reward: { ...reward, isActive: false } })).toMatchObject({ code: "INACTIVE" });
    expect(checkRedemption({ ...base, reward: { ...reward, validTo: new Date(Date.now() - 1000) } })).toMatchObject({ code: "EXPIRED" });
    expect(checkRedemption({ ...base, reward: { ...reward, type: "FREE_ITEM", freeMenuItemId: "x" } })).toMatchObject({ code: "ITEM_NOT_IN_CART" });
  });
  it("expires after inactivity", () => {
    expect(isExpired(new Date(Date.now() - 400 * 86_400_000), 365)).toBe(true);
    expect(isExpired(new Date(), 365)).toBe(false);
    expect(isExpired(new Date(0), 0)).toBe(false);
  });
});

describe("bill status", () => {
  const p = (amountPaise: number, status: "RECORDED" | "VOIDED" = "RECORDED") => ({ amountPaise, status });
  it("derives payment status independently of the order status", () => {
    expect(summarizeBill({ totalPaise: 1000, orderCancelled: false, payments: [], adjustments: [] }).status).toBe("UNPAID");
    expect(summarizeBill({ totalPaise: 1000, orderCancelled: false, payments: [p(400)], adjustments: [] }).status).toBe("PARTIALLY_PAID");
    expect(summarizeBill({ totalPaise: 1000, orderCancelled: false, payments: [p(400), p(600)], adjustments: [] }).status).toBe("PAID");
    expect(summarizeBill({ totalPaise: 1000, orderCancelled: false, payments: [p(1000, "VOIDED")], adjustments: [] }).status).toBe("UNPAID");
    expect(summarizeBill({ totalPaise: 1000, orderCancelled: false, payments: [p(900)], adjustments: [{ type: "DISCOUNT", amountPaise: 100 }] }).status).toBe("PAID");
    expect(summarizeBill({ totalPaise: 1000, orderCancelled: false, payments: [p(1000)], adjustments: [{ type: "REFUND", amountPaise: 1000 }] }).status).toBe("REFUNDED");
    expect(summarizeBill({ totalPaise: 1000, orderCancelled: true, payments: [], adjustments: [] }).status).toBe("VOIDED");
  });
});

describe("phone handling", () => {
  it("normalises Indian numbers with the default country code", () => {
    expect(normalizePhone("98765 43210").e164).toBe("+919876543210");
    expect(normalizePhone("+91-98765-43210").e164).toBe("+919876543210");
    expect(normalizePhone("09876543210").e164).toBe("+919876543210");
    expect(normalizePhone("919876543210").e164).toBe("+919876543210");
    expect(normalizePhone("12345").ok).toBe(false);
    expect(normalizePhone("5876543210").ok).toBe(false); // Indian mobiles start 6-9
    expect(normalizePhone("+14155550123").e164).toBe("+14155550123");
    expect(normalizePhone("abc").ok).toBe(false);
  });
  it("masks numbers for display", () => expect(maskPhone("+919876543210")).toBe("+91 ••••••3210"));
});

describe("availability", () => {
  const now = new Date("2026-10-22T08:00:00Z"); // 13:30 IST
  it("handles daily and overnight windows", () => {
    expect(inDailyWindow("12:00", "15:00", now, "Asia/Kolkata")).toBe(true);
    expect(inDailyWindow("18:00", "23:00", now, "Asia/Kolkata")).toBe(false);
    expect(inDailyWindow("22:00", "14:00", now, "Asia/Kolkata")).toBe(true);
    expect(inDailyWindow(null, null, now, "Asia/Kolkata")).toBe(true);
  });
  it("reports why an item cannot be ordered", () => {
    expect(unavailableReason({ isAvailable: false }, now, "Asia/Kolkata")).toBe("UNAVAILABLE");
    expect(unavailableReason({ isAvailable: true, seasonalFrom: new Date("2027-01-01") }, now, "Asia/Kolkata")).toBe("OUT_OF_SEASON");
    expect(unavailableReason({ isAvailable: true, archivedAt: now }, now, "Asia/Kolkata")).toBe("ARCHIVED");
    expect(unavailableReason({ isAvailable: true }, now, "Asia/Kolkata")).toBeNull();
  });
  it("derives the strictest diet from chosen options", () => {
    expect(effectiveDiet("VEG", ["EGG", null])).toBe("EGG");
    expect(effectiveDiet("VEGAN", [])).toBe("VEGAN");
    expect(effectiveDiet("EGG", ["VEG"])).toBe("EGG");
  });
});

describe("reorder", () => {
  it("rebuilds cart lines from a past order's snapshot", () => {
    const lines = buildReorderLines([
      { menuItemId: "dal", quantity: 2, notes: "less oil", customizations: [{ groupId: "size", optionId: "lg" }, { groupId: "add", optionId: "butter" }, { groupId: "add", optionId: "cheese" }] },
      { menuItemId: "roti", quantity: 50, notes: null, customizations: [{ groupId: null, optionId: null }] },
    ]);
    expect(lines[0]).toEqual({ menuItemId: "dal", quantity: 2, notes: "less oil", selections: [{ groupId: "size", optionIds: ["lg"] }, { groupId: "add", optionIds: ["butter", "cheese"] }] });
    expect(lines[1].quantity).toBe(20); // capped to the per-line maximum
    expect(lines[1].selections).toEqual([]);
  });
});

describe("csv export", () => {
  it("escapes and neutralises formula injection", () => {
    expect(csvCell('a "quoted", value')).toBe('"a ""quoted"", value"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(toCsv(["a", "b"], [[1, null]])).toBe("a,b\r\n1,\r\n");
  });
});

describe("assistant parsing", () => {
  it("extracts structured filters from English and Hindi questions", () => {
    const q = parseAssistantQuery("vegetarian, no nuts, not spicy under ₹300");
    expect(q.diets).toEqual(["VEG", "VEGAN"]);
    expect(q.excludeAllergens).toContain("nuts");
    expect(q.maxSpice).toBe(1);
    expect(q.maxPricePaise).toBe(30000);
    expect(parseAssistantQuery("non veg biryani").diets).toEqual(["NON_VEG"]);
    expect(parseAssistantQuery("dairy free desserts").categorySlugs).toContain("desserts");
    expect(parseAssistantQuery("dairy free desserts").excludeAllergens).toContain("dairy");
    expect(parseAssistantQuery("शाकाहारी 250 से कम").maxPricePaise).toBe(25000);
  });
});

describe("i18n", () => {
  it("has a Hindi translation for every English key", () => {
    expect(Object.keys(en).filter((k) => !(k in hi))).toEqual([]);
  });
  it("interpolates and falls back to English", () => {
    expect(translate("en", "menu.items", { n: 3 })).toBe("3 items");
    expect(translate("hi", "status.PENDING_APPROVAL")).toBe("मंज़ूरी की प्रतीक्षा");
    expect(translate("hi", "no.such.key")).toBe("no.such.key");
  });
});
