// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/components/shared/i18n-provider";
import { PriceBreakdown } from "@/components/customer/price-breakdown";
import { ItemSheet } from "@/components/customer/item-sheet";
import { Stepper } from "@/components/shared/ui";
import type { MenuItemView } from "@/components/customer/menu-types";

afterEach(cleanup);

const wrap = (ui: React.ReactNode, locale: "en" | "hi" = "en") => render(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);

const item: MenuItemView = {
  id: "dal",
  slug: "dal-makhani",
  categoryId: "mains",
  name: "Dal Makhani",
  nameEn: "Dal Makhani",
  description: "Black lentils",
  imageUrl: null,
  pricePaise: 26000,
  taxRateBps: 500,
  dietType: "VEG",
  spiceLevel: 1,
  ingredients: ["lentils"],
  ingredientsEn: ["lentils"],
  prepMinutes: 12,
  calories: null,
  isBestseller: false,
  isRecommended: false,
  allergenInfoVerified: false,
  allergens: [{ key: "dairy", name: "Dairy", level: "CONTAINS" }],
  dietary: [],
  available: true,
  unavailableReason: null,
  groups: [
    { id: "size", name: "Portion", kind: "VARIANT", isRequired: true, minSelect: 1, maxSelect: 1, options: [{ id: "reg", name: "Regular", priceDeltaPaise: 0, isDefault: false, isAvailable: true, dietType: null }, { id: "lg", name: "Large", priceDeltaPaise: 8000, isDefault: false, isAvailable: true, dietType: null }] },
    { id: "add", name: "Add-ons", kind: "ADDON", isRequired: false, minSelect: 0, maxSelect: 1, options: [{ id: "butter", name: "Extra butter", priceDeltaPaise: 3000, isDefault: false, isAvailable: true, dietType: null }] },
  ],
};

describe("PriceBreakdown", () => {
  it("shows tax components, rounding and the payable total", () => {
    wrap(
      <PriceBreakdown
        totals={{ subtotalPaise: 45000, discountPaise: 0, taxPaise: 2250, roundingPaise: 50, totalPaise: 47300, pricesIncludeTax: false, taxBreakdown: [{ code: "GST5", name: "GST", rateBps: 500, taxPaise: 2250, components: [{ name: "CGST", rateBps: 250, amountPaise: 1125 }, { name: "SGST", rateBps: 250, amountPaise: 1125 }] }] }}
      />,
    );
    expect(screen.getByText("CGST 2.50%")).toBeTruthy();
    expect(screen.getByTestId("order-total").textContent).toBe("₹473");
  });
});

describe("ItemSheet", () => {
  it("prices options live, warns about unverified allergens and submits the selection", () => {
    const onSubmit = vi.fn();
    wrap(<ItemSheet item={item} onClose={() => {}} onSubmit={onSubmit} />);
    expect(screen.getByText(/not yet verified/)).toBeTruthy();
    expect(screen.getByText("Contains: Dairy")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Large/));
    fireEvent.click(screen.getByLabelText(/Extra butter/));
    const add = screen.getByRole("button", { name: /Add to cart/ });
    expect(add.textContent).toContain("₹370");
    fireEvent.click(add);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ menuItemId: "dal", quantity: 1, selections: { size: ["lg"], add: ["butter"] }, estUnitPricePaise: 37000 }));
  });

  it("renders Hindi UI labels", () => {
    wrap(<ItemSheet item={item} onClose={() => {}} onSubmit={() => {}} />, "hi");
    expect(screen.getByRole("button", { name: /कार्ट में जोड़ें/ })).toBeTruthy();
  });
});

describe("Stepper", () => {
  it("respects bounds", () => {
    const onChange = vi.fn();
    render(<Stepper value={1} onChange={onChange} min={1} max={2} />);
    expect((screen.getByLabelText("Decrease quantity") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Increase quantity"));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
