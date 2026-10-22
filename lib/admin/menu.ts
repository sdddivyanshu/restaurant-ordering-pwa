import { prisma, withTx } from "@/lib/db/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { badRequest, notFound } from "@/lib/http/errors";
import { audit, type Actor } from "@/lib/audit";
import type { z } from "zod";
import type { categoryUpsertSchema, groupUpsertSchema, itemUpsertSchema } from "@/lib/validation/schemas";
import { publish, topics } from "@/lib/notifications/bus";

type CategoryInput = z.infer<typeof categoryUpsertSchema>;
type ItemInput = z.infer<typeof itemUpsertSchema>;
type GroupInput = z.infer<typeof groupUpsertSchema>;

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "item"
  );
}

async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>) {
  let slug = slugify(base);
  for (let i = 2; await exists(slug); i++) slug = `${slugify(base)}-${i}`;
  return slug;
}

// ───────── Categories ─────────

export async function listCategories() {
  const cats = await prisma.menuCategory.findMany({
    where: { archivedAt: null },
    include: { translations: true, _count: { select: { items: { where: { archivedAt: null } } } } },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  return cats.map((c) => ({ ...c, itemCount: c._count.items }));
}

export async function saveCategory(id: string | null, input: CategoryInput, actor: Actor) {
  return withTx(async (tx) => {
    const before = id ? await tx.menuCategory.findUnique({ where: { id }, include: { translations: true } }) : null;
    if (id && !before) throw notFound("Category not found");
    const slug = input.slug ?? before?.slug ?? (await uniqueSlug(input.name, async (s) => Boolean(await tx.menuCategory.findUnique({ where: { slug: s } }))));
    const data = {
      name: input.name,
      slug,
      description: input.description ?? null,
      parentId: input.parentId ?? null,
      isActive: input.isActive,
      availableFrom: input.availableFrom ?? null,
      availableTo: input.availableTo ?? null,
    };
    const maxOrder = await tx.menuCategory.aggregate({ _max: { displayOrder: true } });
    const cat = id
      ? await tx.menuCategory.update({ where: { id }, data })
      : await tx.menuCategory.create({ data: { ...data, displayOrder: (maxOrder._max.displayOrder ?? 0) + 1 } });
    await tx.menuCategoryTranslation.deleteMany({ where: { categoryId: cat.id } });
    for (const t of input.translations.filter((t) => t.locale !== "en")) {
      await tx.menuCategoryTranslation.create({ data: { categoryId: cat.id, locale: t.locale, name: t.name, description: t.description ?? null } });
    }
    await audit(tx, { actor, action: id ? "menu.category.updated" : "menu.category.created", entityType: "MenuCategory", entityId: cat.id, before, after: input });
    return cat;
  });
}

export async function archiveCategory(id: string, actor: Actor) {
  return withTx(async (tx) => {
    const active = await tx.menuItem.count({ where: { categoryId: id, archivedAt: null } });
    if (active > 0) throw badRequest("Move or archive this category's items first.");
    await tx.menuCategory.update({ where: { id }, data: { archivedAt: new Date(), isActive: false } });
    await audit(tx, { actor, action: "menu.category.archived", entityType: "MenuCategory", entityId: id });
  });
}

// ───────── Items ─────────

export async function listItems(params: { q?: string; categoryId?: string; page: number; pageSize: number }) {
  const where: Prisma.MenuItemWhereInput = {
    archivedAt: null,
    ...(params.categoryId && { categoryId: params.categoryId }),
    ...(params.q && { name: { contains: params.q, mode: "insensitive" } }),
  };
  const [rows, total] = await Promise.all([
    prisma.menuItem.findMany({
      where,
      include: { category: true, translations: { select: { locale: true } }, _count: { select: { customizationGroups: true, allergens: true } } },
      orderBy: [{ category: { displayOrder: "asc" } }, { displayOrder: "asc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.menuItem.count({ where }),
  ]);
  return {
    total,
    page: params.page,
    pageSize: params.pageSize,
    rows: rows.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category.name,
      categoryId: i.categoryId,
      pricePaise: i.basePricePaise,
      dietType: i.dietType,
      isAvailable: i.isAvailable,
      isBestseller: i.isBestseller,
      imageUrl: i.imageUrl,
      displayOrder: i.displayOrder,
      locales: ["en", ...i.translations.map((t) => t.locale)],
      groups: i._count.customizationGroups,
      allergens: i._count.allergens,
      allergenInfoVerified: i.allergenInfoVerified,
    })),
  };
}

export async function getItemForEdit(id: string) {
  const item = await prisma.menuItem.findUnique({
    where: { id },
    include: {
      translations: true,
      allergens: { include: { allergen: true } },
      dietaryAttributes: { include: { attribute: true } },
      customizationGroups: { orderBy: { displayOrder: "asc" } },
    },
  });
  if (!item) throw notFound("Item not found");
  return {
    ...item,
    allergens: item.allergens.map((a) => ({ key: a.allergen.key, level: a.level })),
    dietaryAttributes: item.dietaryAttributes.map((d) => d.attribute.key),
    customizationGroupIds: item.customizationGroups.map((g) => g.groupId),
  };
}

export async function saveItem(id: string | null, input: ItemInput, actor: Actor) {
  const result = await withTx(async (tx) => {
    const before = id ? await tx.menuItem.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound("Item not found");
    const slug = input.slug ?? before?.slug ?? (await uniqueSlug(input.name, async (s) => Boolean(await tx.menuItem.findUnique({ where: { slug: s } }))));
    const data = {
      slug,
      name: input.name,
      description: input.description ?? null,
      categoryId: input.categoryId,
      imageUrl: input.imageUrl ?? null,
      basePricePaise: input.basePricePaise,
      taxConfigId: input.taxConfigId,
      dietType: input.dietType,
      spiceLevel: input.spiceLevel,
      ingredients: input.ingredients,
      prepMinutes: input.prepMinutes,
      calories: input.calories ?? null,
      isAvailable: input.isAvailable,
      isBestseller: input.isBestseller,
      isRecommended: input.isRecommended,
      allergenInfoVerified: input.allergenInfoVerified,
      availableFrom: input.availableFrom ?? null,
      availableTo: input.availableTo ?? null,
      seasonalFrom: input.seasonalFrom ?? null,
      seasonalTo: input.seasonalTo ?? null,
      updatedById: actor.id ?? null,
    };
    let item;
    if (id) item = await tx.menuItem.update({ where: { id }, data });
    else {
      const maxOrder = await tx.menuItem.aggregate({ where: { categoryId: input.categoryId }, _max: { displayOrder: true } });
      item = await tx.menuItem.create({ data: { ...data, displayOrder: (maxOrder._max.displayOrder ?? 0) + 1 } });
    }

    await tx.menuItemTranslation.deleteMany({ where: { itemId: item.id } });
    for (const t of input.translations.filter((t) => t.locale !== "en" && t.name.trim())) {
      await tx.menuItemTranslation.create({ data: { itemId: item.id, locale: t.locale, name: t.name, description: t.description ?? null, ingredients: t.ingredients } });
    }
    await tx.itemAllergen.deleteMany({ where: { itemId: item.id } });
    if (input.allergens.length) {
      const allergens = await tx.allergen.findMany({ where: { key: { in: input.allergens.map((a) => a.key) } } });
      for (const a of input.allergens) {
        const found = allergens.find((x) => x.key === a.key);
        if (!found) throw badRequest(`Unknown allergen: ${a.key}`);
        await tx.itemAllergen.create({ data: { itemId: item.id, allergenId: found.id, level: a.level } });
      }
    }
    await tx.itemDietaryAttribute.deleteMany({ where: { itemId: item.id } });
    if (input.dietaryAttributes.length) {
      const attrs = await tx.dietaryAttribute.findMany({ where: { key: { in: input.dietaryAttributes } } });
      for (const a of attrs) await tx.itemDietaryAttribute.create({ data: { itemId: item.id, attributeId: a.id } });
    }
    await tx.menuItemCustomizationGroup.deleteMany({ where: { itemId: item.id } });
    for (const [idx, groupId] of input.customizationGroupIds.entries()) {
      await tx.menuItemCustomizationGroup.create({ data: { itemId: item.id, groupId, displayOrder: idx } });
    }
    await audit(tx, {
      actor,
      action: id ? (before!.basePricePaise !== input.basePricePaise ? "menu.item.price_changed" : "menu.item.updated") : "menu.item.created",
      entityType: "MenuItem",
      entityId: item.id,
      before: before ? { basePricePaise: before.basePricePaise, isAvailable: before.isAvailable, name: before.name } : undefined,
      after: { basePricePaise: input.basePricePaise, isAvailable: input.isAvailable, name: input.name },
    });
    return item;
  });
  publish(topics.staff, "menu.updated", { itemId: result.id });
  return result;
}

export async function setItemAvailability(id: string, isAvailable: boolean, actor: Actor) {
  return withTx(async (tx) => {
    const before = await tx.menuItem.findUnique({ where: { id } });
    if (!before) throw notFound("Item not found");
    const item = await tx.menuItem.update({ where: { id }, data: { isAvailable, updatedById: actor.id ?? null } });
    await audit(tx, { actor, action: "menu.item.availability", entityType: "MenuItem", entityId: id, before: { isAvailable: before.isAvailable }, after: { isAvailable } });
    return item;
  });
}

export async function archiveItem(id: string, actor: Actor) {
  return withTx(async (tx) => {
    await tx.menuItem.update({ where: { id }, data: { archivedAt: new Date(), isAvailable: false } });
    await audit(tx, { actor, action: "menu.item.archived", entityType: "MenuItem", entityId: id });
  });
}

export async function reorderEntities(entity: "category" | "item", ids: string[], actor: Actor) {
  return withTx(async (tx) => {
    for (const [idx, id] of ids.entries()) {
      if (entity === "category") await tx.menuCategory.update({ where: { id }, data: { displayOrder: idx + 1 } });
      else await tx.menuItem.update({ where: { id }, data: { displayOrder: idx + 1 } });
    }
    await audit(tx, { actor, action: `menu.${entity}.reordered`, entityType: entity === "category" ? "MenuCategory" : "MenuItem", entityId: "bulk", meta: { count: ids.length } });
  });
}

// ───────── Customization groups ─────────

export async function listGroups() {
  return prisma.customizationGroup.findMany({
    where: { archivedAt: null },
    include: { options: { where: { archivedAt: null }, orderBy: { displayOrder: "asc" } }, _count: { select: { items: true } } },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}

export async function saveGroup(id: string | null, input: GroupInput, actor: Actor) {
  return withTx(async (tx) => {
    const before = id ? await tx.customizationGroup.findUnique({ where: { id }, include: { options: true } }) : null;
    if (id && !before) throw notFound("Group not found");
    const key = input.key ?? before?.key ?? (await uniqueSlug(input.name, async (s) => Boolean(await tx.customizationGroup.findUnique({ where: { key: s } }))));
    const data = {
      key,
      name: input.name,
      nameI18n: input.nameI18n,
      kind: input.kind,
      isRequired: input.isRequired,
      minSelect: input.minSelect,
      maxSelect: input.maxSelect,
    };
    const group = id ? await tx.customizationGroup.update({ where: { id }, data }) : await tx.customizationGroup.create({ data });
    const keepIds = new Set<string>();
    for (const [idx, o] of input.options.entries()) {
      const optData = {
        name: o.name,
        nameI18n: o.nameI18n,
        priceDeltaPaise: o.priceDeltaPaise,
        isDefault: o.isDefault,
        isAvailable: o.isAvailable,
        dietType: o.dietType ?? null,
        displayOrder: idx,
      };
      if (o.id && before?.options.some((x) => x.id === o.id)) {
        await tx.customizationOption.update({ where: { id: o.id }, data: optData });
        keepIds.add(o.id);
      } else {
        const created = await tx.customizationOption.create({ data: { ...optData, groupId: group.id } });
        keepIds.add(created.id);
      }
    }
    // Removed options are archived (not deleted) so historical orders keep their references.
    await tx.customizationOption.updateMany({ where: { groupId: group.id, id: { notIn: [...keepIds] }, archivedAt: null }, data: { archivedAt: new Date(), isAvailable: false } });
    await audit(tx, { actor, action: id ? "menu.group.updated" : "menu.group.created", entityType: "CustomizationGroup", entityId: group.id, before, after: input });
    return group;
  });
}

export async function archiveGroup(id: string, actor: Actor) {
  return withTx(async (tx) => {
    await tx.customizationGroup.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit(tx, { actor, action: "menu.group.archived", entityType: "CustomizationGroup", entityId: id });
  });
}

export async function menuReferenceData() {
  const [taxes, allergens, attributes, categories, groups] = await Promise.all([
    prisma.taxConfiguration.findMany({ where: { isActive: true }, orderBy: { rateBps: "asc" } }),
    prisma.allergen.findMany({ orderBy: { name: "asc" } }),
    prisma.dietaryAttribute.findMany({ orderBy: { name: "asc" } }),
    prisma.menuCategory.findMany({ where: { archivedAt: null }, orderBy: { displayOrder: "asc" } }),
    prisma.customizationGroup.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, include: { options: { where: { archivedAt: null } } } }),
  ]);
  return { taxes, allergens, attributes, categories, groups };
}
