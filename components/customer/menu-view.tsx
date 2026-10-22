"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useI18n } from "@/components/shared/i18n-provider";
import { useCart } from "@/components/customer/cart-provider";
import { ItemSheet } from "@/components/customer/item-sheet";
import { AssistantSheet } from "@/components/customer/assistant-sheet";
import { Badge, Button, DietMark, EmptyState, ErrorNotice, FoodImage, Skeleton, SpiceMeter, cx } from "@/components/shared/ui";
import { formatMoney } from "@/lib/pricing/money";
import type { Menu, MenuItemView } from "@/components/customer/menu-types";

type DietFilter = "all" | "veg" | "vegan" | "egg" | "nonveg";

export function MenuView() {
  const { t, locale } = useI18n();
  const cart = useCart();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [diet, setDiet] = useState<DietFilter>("all");
  const [avoid, setAvoid] = useState<string[]>([]);
  const [showAvoid, setShowAvoid] = useState(false);
  const [openItem, setOpenItem] = useState<MenuItemView | null>(null);
  const [assistant, setAssistant] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<Menu>(`/api/v1/public/menu?lang=${locale}`)
      .then(setMenu)
      .catch((e) => setError(e instanceof ApiClientError ? e : new ApiClientError(0, "UNKNOWN", String(e))));
  }, [locale]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(id);
  }, [toast]);

  const filtered = useMemo(() => {
    if (!menu) return [];
    const q = search.trim().toLowerCase();
    return menu.items.filter((i) => {
      if (category && i.categoryId !== category) return false;
      if (diet === "veg" && !(i.dietType === "VEG" || i.dietType === "VEGAN")) return false;
      if (diet === "vegan" && i.dietType !== "VEGAN") return false;
      if (diet === "egg" && i.dietType !== "EGG") return false;
      if (diet === "nonveg" && i.dietType !== "NON_VEG") return false;
      if (avoid.length && i.allergens.some((a) => avoid.includes(a.key))) return false;
      if (q) {
        const hay = [i.name, i.nameEn, i.description ?? "", ...i.ingredients, ...i.ingredientsEn].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [menu, search, category, diet, avoid]);

  const filtersActive = Boolean(search || category || diet !== "all" || avoid.length);
  const bestsellers = menu?.items.filter((i) => i.isBestseller && i.available).slice(0, 8) ?? [];

  function quickAdd(item: MenuItemView) {
    // Items with any customization open the sheet so choices are always explicit.
    if (item.groups.length) {
      setOpenItem(item);
      return;
    }
    cart.add({ menuItemId: item.id, name: item.name, imageUrl: item.imageUrl, dietType: item.dietType, quantity: 1, selections: {}, optionLabels: [], estUnitPricePaise: item.pricePaise });
    setToast(`✓ ${item.name}`);
  }

  const reasonLabel = (r: string | null) => (r === "OUT_OF_HOURS" ? t("menu.outOfHours") : r === "OUT_OF_SEASON" ? t("menu.outOfSeason") : t("menu.unavailable"));

  if (error && !menu)
    return (
      <div className="p-4">
        <ErrorNotice message={error.isNetwork ? t("common.offline") : error.message} onRetry={load} retryLabel={t("common.retry")} />
      </div>
    );

  return (
    <div>
      <div className="sticky top-[57px] z-20 space-y-2 bg-cream/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">{t("menu.search")}</span>
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("menu.search")}
              className="h-11 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-3 text-[15px] shadow-soft outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <button onClick={() => setAssistant(true)} className="flex h-11 items-center gap-1.5 rounded-xl bg-ink px-3 text-sm font-semibold text-white shadow-soft" aria-label={t("menu.askAssistant")}>
            <span aria-hidden>✨</span>
            <span className="hidden sm:inline">{t("menu.askAssistant")}</span>
          </button>
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Filters">
          {(
            [
              ["all", t("menu.all")],
              ["veg", t("menu.vegOnly")],
              ["vegan", t("menu.vegan")],
              ["egg", t("menu.egg")],
              ["nonveg", t("menu.nonVeg")],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setDiet(k)}
              aria-pressed={diet === k}
              className={cx("flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold", diet === k ? "border-ink bg-ink text-white" : "border-stone-200 bg-white text-ink")}
            >
              {k === "veg" && <DietMark diet="VEG" size={12} />}
              {k === "nonveg" && <DietMark diet="NON_VEG" size={12} />}
              {k === "egg" && <DietMark diet="EGG" size={12} />}
              {label}
            </button>
          ))}
          <button
            onClick={() => setShowAvoid((v) => !v)}
            aria-expanded={showAvoid}
            className={cx("h-9 shrink-0 rounded-full border px-3 text-sm font-semibold", avoid.length ? "border-red-700 bg-red-50 text-red-800" : "border-stone-200 bg-white")}
          >
            ⚠ {t("menu.avoid")}
            {avoid.length > 0 && ` (${avoid.length})`}
          </button>
        </div>
        {showAvoid && menu && (
          <div className="flex flex-wrap gap-2 rounded-2xl bg-white p-3 shadow-soft">
            {menu.allergens.map((a) => {
              const on = avoid.includes(a.key);
              return (
                <button
                  key={a.key}
                  aria-pressed={on}
                  onClick={() => setAvoid((s) => (on ? s.filter((x) => x !== a.key) : [...s, a.key]))}
                  className={cx("rounded-full px-3 py-1.5 text-xs font-semibold ring-1", on ? "bg-red-700 text-white ring-red-700" : "bg-white ring-stone-300")}
                >
                  {on ? "✕ " : ""}
                  {a.name}
                </button>
              );
            })}
            <p className="w-full text-xs text-muted">{t("item.allergyNote")}</p>
          </div>
        )}
        <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4">
          <button onClick={() => setCategory(null)} className={cx("shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold", !category ? "bg-brand-100 text-brand-800" : "text-muted")}>
            {t("menu.all")}
          </button>
          {menu?.categories.map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)} aria-pressed={category === c.id} className={cx("shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold", category === c.id ? "bg-brand-100 text-brand-800" : "text-muted")}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {!menu ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="px-4">
          {!filtersActive && bestsellers.length > 0 && (
            <section className="mb-5 mt-2" aria-labelledby="best">
              <h2 id="best" className="mb-2 font-display text-xl font-semibold">
                {t("menu.bestsellers")}
              </h2>
              <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
                {bestsellers.map((i) => (
                  <button key={i.id} onClick={() => setOpenItem(i)} className="w-40 shrink-0 snap-start overflow-hidden rounded-2xl bg-white text-left shadow-soft">
                    <FoodImage src={i.imageUrl} alt="" className="aspect-[4/3] w-full" />
                    <div className="p-2.5">
                      <div className="flex items-center gap-1.5">
                        <DietMark diet={i.dietType} size={12} />
                        <span className="truncate text-sm font-semibold">{i.name}</span>
                      </div>
                      <div className="mt-0.5 text-sm tabular-nums text-muted">{formatMoney(i.pricePaise)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {filtered.length === 0 ? (
            <EmptyState title={t("menu.noResults")} action={<Button variant="secondary" onClick={() => { setSearch(""); setCategory(null); setDiet("all"); setAvoid([]); }}>{t("menu.clearFilters")}</Button>} icon="🔍" />
          ) : (
            menu.categories
              .filter((c) => filtered.some((i) => i.categoryId === c.id))
              .map((c) => (
                <section key={c.id} className="mb-6" aria-labelledby={`cat-${c.id}`}>
                  <h2 id={`cat-${c.id}`} className="mb-1 font-display text-xl font-semibold">
                    {c.name}
                  </h2>
                  {c.description && <p className="mb-3 text-sm text-muted">{c.description}</p>}
                  <ul className="space-y-3">
                    {filtered
                      .filter((i) => i.categoryId === c.id)
                      .map((i) => (
                        <li key={i.id}>
                          <article className={cx("flex gap-3 rounded-2xl bg-white p-3 shadow-soft", !i.available && "opacity-60")}>
                            <button onClick={() => setOpenItem(i)} className="min-w-0 flex-1 text-left">
                              <div className="flex items-center gap-1.5">
                                <DietMark diet={i.dietType} label={t(`diet.${i.dietType}` as "diet.VEG")} />
                                {i.isBestseller && <span className="text-[11px] font-bold uppercase tracking-wide text-brand-600">★ {t("menu.bestsellers")}</span>}
                              </div>
                              <h3 className="mt-1 font-semibold leading-snug">{i.name}</h3>
                              <div className="mt-0.5 flex items-center gap-2">
                                <span className="font-semibold tabular-nums">{formatMoney(i.pricePaise)}</span>
                                <SpiceMeter level={i.spiceLevel} label={t("menu.spice")} />
                              </div>
                              {i.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{i.description}</p>}
                              <div className="mt-2 flex flex-wrap gap-1">
                                {!i.available && <Badge tone="red">{reasonLabel(i.unavailableReason)}</Badge>}
                                {i.allergens.slice(0, 3).map((a) => (
                                  <Badge key={a.key} tone={a.level === "CONTAINS" ? "neutral" : "amber"}>
                                    {a.name}
                                  </Badge>
                                ))}
                                {!i.allergenInfoVerified && <Badge tone="amber">⚠</Badge>}
                              </div>
                            </button>
                            <div className="relative w-28 shrink-0">
                              <FoodImage src={i.imageUrl} alt={i.name} className="aspect-square w-28 rounded-xl" />
                              {i.available && (
                                <button
                                  onClick={() => quickAdd(i)}
                                  className="absolute -bottom-2 left-1/2 h-9 -translate-x-1/2 rounded-lg border border-brand-200 bg-white px-5 text-sm font-bold uppercase text-brand-700 shadow-soft hover:bg-brand-50"
                                  aria-label={`${t("menu.add")} ${i.name}`}
                                >
                                  {t("menu.add")}
                                </button>
                              )}
                              {i.groups.length > 0 && i.available && <p className="mt-3 text-center text-[10px] text-muted">{t("menu.customizable")}</p>}
                            </div>
                          </article>
                        </li>
                      ))}
                  </ul>
                </section>
              ))
          )}
        </div>
      )}

      {cart.count > 0 && (
        <div className="fixed inset-x-0 bottom-[68px] z-30 mx-auto max-w-2xl px-4">
          <Link href="/cart" className="flex items-center justify-between rounded-2xl bg-brand-700 px-4 py-3 text-white shadow-lift">
            <span className="text-sm">
              <span className="font-bold">{t("menu.items", { n: cart.count })}</span>
              <span className="opacity-80"> · ~{formatMoney(cart.estTotalPaise)}</span>
            </span>
            <span className="font-semibold">{t("menu.viewCart")} →</span>
          </Link>
        </div>
      )}

      {toast && (
        <div className="fixed inset-x-0 top-20 z-50 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white shadow-lift" role="status">
          {toast}
        </div>
      )}

      {openItem && (
        <ItemSheet
          key={openItem.id}
          item={openItem}
          onClose={() => setOpenItem(null)}
          onSubmit={(line) => {
            cart.add(line);
            setOpenItem(null);
            setToast(`✓ ${line.name}`);
          }}
        />
      )}
      {assistant && menu && (
        <AssistantSheet
          onClose={() => setAssistant(false)}
          onPick={(id) => {
            const item = menu.items.find((i) => i.id === id);
            if (item) {
              setAssistant(false);
              setOpenItem(item);
            }
          }}
        />
      )}
    </div>
  );
}
