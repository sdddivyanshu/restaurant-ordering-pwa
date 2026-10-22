import type { Tx } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Quote } from "@/lib/pricing/quote";

/** Persist an immutable snapshot of quoted lines as OrderItems for a given order version. */
export async function createOrderItemsFromQuote(tx: Tx, orderId: string, version: number, quote: Quote) {
  const detailByIndex = new Map(quote.details.map((d) => [String(d.index), d]));
  for (const line of quote.lines) {
    const d = detailByIndex.get(line.key)!;
    await tx.orderItem.create({
      data: {
        orderId,
        version,
        menuItemId: line.menuItemId,
        nameSnapshot: line.name,
        nameI18nSnapshot: d.nameI18n as Prisma.InputJsonValue,
        dietType: d.dietType,
        quantity: line.quantity,
        unitBasePaise: line.basePricePaise,
        unitOptionsPaise: line.unitOptionsPaise,
        unitPricePaise: line.unitPricePaise,
        lineSubtotalPaise: line.lineSubtotalPaise,
        lineDiscountPaise: line.lineDiscountPaise,
        lineTaxPaise: line.lineTaxPaise,
        lineTotalPaise: line.lineTotalPaise,
        taxCode: line.taxCode,
        taxRateBps: line.taxRateBps,
        taxComponents: line.taxComponents as unknown as Prisma.InputJsonValue,
        prepMinutes: d.prepMinutes,
        allergenSnapshot: d.allergens,
        notes: d.notes,
        customizations: {
          create: line.options.map((o) => ({
            groupId: o.groupId,
            groupName: o.groupName,
            optionId: o.optionId,
            optionName: o.optionName,
            priceDeltaPaise: o.priceDeltaPaise,
          })),
        },
      },
    });
  }
}

export function totalsFromQuote(quote: Quote) {
  return {
    subtotalPaise: quote.subtotalPaise,
    discountPaise: quote.discountPaise,
    taxPaise: quote.taxPaise,
    roundingPaise: quote.roundingPaise,
    totalPaise: quote.totalPaise,
    taxBreakdown: quote.taxBreakdown as unknown as Prisma.InputJsonValue,
    pricesIncludeTax: quote.pricesIncludeTax,
  };
}
