"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/components/shared/i18n-provider";
import { Badge, Button, DietMark, FoodImage, Notice, Sheet, SpiceMeter, Stepper, cx } from "@/components/shared/ui";
import { defaultSelections, effectiveMin, validateSelections, type Selections } from "@/lib/menu/customization";
import { effectiveDiet } from "@/lib/menu/diet";
import { formatMoney } from "@/lib/pricing/money";
import type { MenuItemView } from "@/components/customer/menu-types";
import type { CartLine } from "@/components/customer/cart-provider";

export function ItemSheet({
  item,
  onClose,
  onSubmit,
  initial,
}: {
  item: MenuItemView;
  onClose: () => void;
  onSubmit: (line: Omit<CartLine, "key">) => void;
  initial?: { quantity: number; selections: Selections; notes?: string };
}) {
  const { t } = useI18n();
  const [selections, setSelections] = useState<Selections>(() => initial?.selections ?? defaultSelections(item.groups));
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [touched, setTouched] = useState(false);

  const errors = useMemo(() => validateSelections(item.groups, selections), [item.groups, selections]);
  const chosenOptions = item.groups.flatMap((g) => g.options.filter((o) => (selections[g.id] ?? []).includes(o.id)));
  const unit = item.pricePaise + chosenOptions.reduce((s, o) => s + o.priceDeltaPaise, 0);
  const diet = effectiveDiet(item.dietType, chosenOptions.map((o) => o.dietType));

  function toggle(groupId: string, optionId: string, single: boolean) {
    setSelections((s) => {
      const cur = s[groupId] ?? [];
      if (single) return { ...s, [groupId]: cur.includes(optionId) && effectiveMin(item.groups.find((g) => g.id === groupId)!) === 0 ? [] : [optionId] };
      return { ...s, [groupId]: cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId] };
    });
  }

  function submit() {
    setTouched(true);
    if (errors.length || !item.available) return;
    onSubmit({
      menuItemId: item.id,
      name: item.name,
      imageUrl: item.imageUrl,
      dietType: diet,
      quantity,
      selections,
      optionLabels: chosenOptions.map((o) => o.name),
      notes: notes.trim() || undefined,
      estUnitPricePaise: unit,
    });
  }

  const contains = item.allergens.filter((a) => a.level === "CONTAINS");
  const mayContain = item.allergens.filter((a) => a.level === "MAY_CONTAIN");

  return (
    <Sheet
      open
      onClose={onClose}
      title={item.name}
      footer={
        <div className="flex items-center gap-3">
          <Stepper value={quantity} onChange={setQuantity} />
          <Button size="lg" className="flex-1" onClick={submit} disabled={!item.available}>
            {item.available ? t(initial ? "item.update" : "item.addToCart", { price: formatMoney(unit * quantity) }) : t("menu.unavailable")}
          </Button>
        </div>
      }
    >
      <FoodImage src={item.imageUrl} alt={item.name} className="-mx-5 -mt-4 mb-4 aspect-[16/9] w-[calc(100%+2.5rem)] max-w-none" />
      <div className="flex items-start gap-2">
        <DietMark diet={diet} label={t(`diet.${diet}` as "diet.VEG")} size={18} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{formatMoney(item.pricePaise)}</span>
            <SpiceMeter level={item.spiceLevel} label={t("menu.spice")} />
            <span className="text-xs text-muted">{t("menu.prep", { n: item.prepMinutes })}</span>
            {item.isBestseller && <Badge tone="brand">★ {t("menu.bestsellers")}</Badge>}
          </div>
          {item.description && <p className="mt-2 text-sm text-muted">{item.description}</p>}
        </div>
      </div>

      <section className="mt-4 space-y-2 rounded-2xl bg-white p-3 text-sm shadow-soft">
        {item.ingredients.length > 0 && (
          <p>
            <span className="font-semibold">{t("item.ingredients")}: </span>
            {item.ingredients.join(", ")}
          </p>
        )}
        <div>
          <span className="font-semibold">{t("item.allergens")}: </span>
          {item.allergens.length === 0 ? (
            <span className="text-muted">{t("item.noAllergens")}</span>
          ) : (
            <span className="inline-flex flex-wrap gap-1 align-middle">
              {contains.map((a) => (
                <Badge key={a.key} tone="red">
                  {t("item.contains")}: {a.name}
                </Badge>
              ))}
              {mayContain.map((a) => (
                <Badge key={a.key} tone="amber">
                  {t("item.mayContain")}: {a.name}
                </Badge>
              ))}
            </span>
          )}
        </div>
        {item.dietary.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.dietary.map((d) => (
              <Badge key={d.key} tone="green">
                {d.name}
              </Badge>
            ))}
          </div>
        )}
        {!item.allergenInfoVerified ? <Notice tone="amber">{t("item.unverified")}</Notice> : <p className="text-xs text-muted">{t("item.allergyNote")}</p>}
      </section>

      {item.groups.map((g) => {
        const single = g.maxSelect === 1;
        const min = effectiveMin(g);
        const err = touched ? errors.find((e) => e.groupId === g.id) : undefined;
        const hint = min === g.maxSelect ? t("item.chooseN", { n: min }) : min === 0 ? t("item.chooseUpTo", { n: g.maxSelect }) : t("item.chooseBetween", { min, max: g.maxSelect });
        return (
          <fieldset key={g.id} className="mt-5" aria-describedby={err ? `err-${g.id}` : undefined}>
            <legend className="flex w-full items-center justify-between">
              <span className="font-semibold">{g.name}</span>
              <span className="text-xs text-muted">
                {min > 0 ? <Badge tone="brand">{t("item.required")}</Badge> : t("item.optional")} · {hint}
              </span>
            </legend>
            <div className="mt-2 divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white">
              {g.options.map((o) => {
                const checked = (selections[g.id] ?? []).includes(o.id);
                const atMax = !single && !checked && (selections[g.id]?.length ?? 0) >= g.maxSelect;
                return (
                  <label key={o.id} className={cx("flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2", (!o.isAvailable || atMax) && "cursor-not-allowed opacity-50")}>
                    <input
                      type={single ? "radio" : "checkbox"}
                      name={g.id}
                      checked={checked}
                      disabled={!o.isAvailable || atMax}
                      onChange={() => toggle(g.id, o.id, single)}
                      onClick={() => single && checked && min === 0 && toggle(g.id, o.id, true)}
                      className="h-5 w-5 accent-brand-600"
                    />
                    <span className="flex-1 text-sm">
                      {o.name}
                      {o.dietType && o.dietType !== item.dietType && (
                        <span className="ml-2 inline-flex align-middle">
                          <DietMark diet={o.dietType} size={12} />
                        </span>
                      )}
                      {!o.isAvailable && <span className="ml-2 text-xs text-red-700">{t("menu.unavailable")}</span>}
                    </span>
                    {o.priceDeltaPaise !== 0 && <span className="text-sm tabular-nums text-muted">+{formatMoney(o.priceDeltaPaise)}</span>}
                  </label>
                );
              })}
            </div>
            {err && (
              <p id={`err-${g.id}`} className="mt-1 text-xs text-red-700" role="alert">
                {err.message}
              </p>
            )}
          </fieldset>
        );
      })}

      <label className="mt-5 block">
        <span className="text-sm font-semibold">{t("item.notes")}</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={200}
          placeholder={t("item.notesPlaceholder")}
          className="mt-1 h-11 w-full rounded-xl border border-stone-300 bg-white px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
      </label>
    </Sheet>
  );
}
