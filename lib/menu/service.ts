import { prisma } from "@/lib/db/prisma";
import { unavailableReason } from "@/lib/menu/availability";
import { getRestaurantConfig } from "@/lib/settings";
import type { DietTypeValue } from "@/lib/menu/diet";

function tr(i18n: unknown, lang: string, fallback: string): string {
  const map = (i18n ?? {}) as Record<string, string>;
  return (map[lang] && map[lang].trim()) || fallback;
}

/** Public menu with translations (English fallback) and live availability. Safe to cache publicly. */
export async function getPublicMenu(lang: string) {
  const { restaurant } = await getRestaurantConfig();
  const now = new Date();
  const [categories, items, allergens, attributes] = await Promise.all([
    prisma.menuCategory.findMany({
      where: { isActive: true, archivedAt: null },
      include: { translations: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    }),
    prisma.menuItem.findMany({
      where: { archivedAt: null, category: { isActive: true, archivedAt: null } },
      include: {
        category: true,
        taxConfig: true,
        translations: true,
        allergens: { include: { allergen: true } },
        dietaryAttributes: { include: { attribute: true } },
        customizationGroups: {
          where: { group: { archivedAt: null } },
          include: { group: { include: { options: { where: { archivedAt: null }, orderBy: { displayOrder: "asc" } } } } },
          orderBy: { displayOrder: "asc" },
        },
      },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    }),
    prisma.allergen.findMany({ orderBy: { name: "asc" } }),
    prisma.dietaryAttribute.findMany({ orderBy: { name: "asc" } }),
  ]);

  return {
    lang,
    currency: restaurant.currency,
    categories: categories.map((c) => {
      const t = c.translations.find((x) => x.locale === lang);
      return { id: c.id, slug: c.slug, parentId: c.parentId, name: t?.name || c.name, description: t?.description || c.description, displayOrder: c.displayOrder };
    }),
    items: items.map((i) => {
      const t = i.translations.find((x) => x.locale === lang);
      const reason = unavailableReason(i, now, restaurant.timezone);
      return {
        id: i.id,
        slug: i.slug,
        categoryId: i.categoryId,
        name: t?.name || i.name,
        nameEn: i.name,
        description: t?.description || i.description,
        imageUrl: i.imageUrl,
        pricePaise: i.basePricePaise,
        taxRateBps: i.taxConfig.rateBps,
        dietType: i.dietType as DietTypeValue,
        spiceLevel: i.spiceLevel,
        ingredients: t?.ingredients?.length ? t.ingredients : i.ingredients,
        ingredientsEn: i.ingredients,
        prepMinutes: i.prepMinutes,
        calories: i.calories,
        isBestseller: i.isBestseller,
        isRecommended: i.isRecommended,
        allergenInfoVerified: i.allergenInfoVerified,
        allergens: i.allergens.map((a) => ({ key: a.allergen.key, name: tr(a.allergen.nameI18n, lang, a.allergen.name), level: a.level })),
        dietary: i.dietaryAttributes.map((d) => ({ key: d.attribute.key, name: tr(d.attribute.nameI18n, lang, d.attribute.name) })),
        available: reason === null,
        unavailableReason: reason,
        groups: i.customizationGroups.map(({ group: g }) => ({
          id: g.id,
          name: tr(g.nameI18n, lang, g.name),
          kind: g.kind,
          isRequired: g.isRequired,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          options: g.options.map((o) => ({
            id: o.id,
            name: tr(o.nameI18n, lang, o.name),
            priceDeltaPaise: o.priceDeltaPaise,
            isDefault: o.isDefault,
            isAvailable: o.isAvailable,
            dietType: o.dietType as DietTypeValue | null,
          })),
        })),
      };
    }),
    allergens: allergens.map((a) => ({ key: a.key, name: tr(a.nameI18n, lang, a.name) })),
    dietaryAttributes: attributes.map((d) => ({ key: d.key, name: tr(d.nameI18n, lang, d.name) })),
    generatedAt: now.toISOString(),
  };
}

export type PublicMenu = Awaited<ReturnType<typeof getPublicMenu>>;
export type PublicMenuItem = PublicMenu["items"][number];
