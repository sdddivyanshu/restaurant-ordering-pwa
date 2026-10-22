"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiClientError, newIdempotencyKey } from "@/lib/client/api";
import { useOnline } from "@/lib/client/use-live";
import { useI18n } from "@/components/shared/i18n-provider";
import { useCart, type CartLine } from "@/components/customer/cart-provider";
import { useCustomerSession } from "@/components/customer/session-provider";
import { ItemSheet } from "@/components/customer/item-sheet";
import { PriceBreakdown } from "@/components/customer/price-breakdown";
import { Button, DietMark, EmptyState, ErrorNotice, FoodImage, Notice, Sheet, Skeleton, Stepper, cx } from "@/components/shared/ui";
import { formatMoney } from "@/lib/pricing/money";
import type { SerializedQuote } from "@/lib/pricing/quote";
import type { Menu } from "@/components/customer/menu-types";

interface RewardsResponse {
  verified: boolean;
  balance?: number;
  rewards: { id: string; name: string; description: string | null; pointsCost: number; affordable?: boolean }[];
}

export function CartView() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const cart = useCart();
  const { session } = useCustomerSession();
  const [quote, setQuote] = useState<SerializedQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [rewards, setRewards] = useState<RewardsResponse | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<{ kind: "offline" | "unconfirmed" | "message"; text: string } | null>(null);
  const [priceChanged, setPriceChanged] = useState(false);
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const seq = useRef(0);

  const apiLines = cart.apiLines();
  const linesKey = JSON.stringify([apiLines, cart.rewardId]);

  useEffect(() => {
    try {
      const f = sessionStorage.getItem("rs_flash");
      if (f) {
        setFlash(f);
        sessionStorage.removeItem("rs_flash");
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Server-side quote whenever the cart changes (debounced). The server is the source of truth.
  useEffect(() => {
    if (apiLines.length === 0) {
      setQuote(null);
      return;
    }
    const my = ++seq.current;
    setQuoting(true);
    const id = setTimeout(() => {
      api<SerializedQuote>("/api/v1/customer/cart", { body: { lines: apiLines, rewardId: cart.rewardId } })
        .then((q) => {
          if (my !== seq.current) return;
          setQuote(q);
          setQuoteError(null);
        })
        .catch((e) => my === seq.current && setQuoteError(e instanceof ApiClientError ? (e.isNetwork ? t("common.offline") : e.message) : String(e)))
        .finally(() => my === seq.current && setQuoting(false));
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey]);

  useEffect(() => {
    if (session?.customer.verified) api<RewardsResponse>("/api/v1/customer/rewards").then(setRewards).catch(() => {});
  }, [session?.customer.verified]);

  async function openEditor(line: CartLine) {
    if (!menu) {
      try {
        setMenu(await api<Menu>(`/api/v1/public/menu?lang=${locale}`));
      } catch {
        return;
      }
    }
    setEditing(line);
  }

  const issueByIndex = new Map((quote?.issues ?? []).map((i) => [i.index, i]));
  const hasIssues = (quote?.issues.length ?? 0) > 0;
  const canReview = !!quote && !hasIssues && !quoting && quote.lines.length > 0 && !(cart.rewardId && quote.rewardError);

  async function placeOrder() {
    if (!quote) return;
    if (!online) {
      setPlaceError({ kind: "offline", text: t("cart.notSent") });
      return;
    }
    // Reuse the idempotency key for an unchanged cart so retries can never duplicate an order.
    const fp = cart.fingerprint();
    let key = cart.pendingKey?.fingerprint === fp ? cart.pendingKey.key : null;
    if (!key) {
      key = newIdempotencyKey();
      cart.setPendingKey({ key, fingerprint: fp });
    }
    setPlacing(true);
    setPlaceError(null);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await api<{ order: { id: string } }>("/api/v1/customer/orders", {
        body: { lines: apiLines, rewardId: cart.rewardId, specialInstructions: cart.specialInstructions.trim() || undefined, expectedTotalPaise: quote.totalPaise, idempotencyKey: key },
        signal: ctrl.signal,
      });
      cart.clear();
      router.push(`/orders/${res.order.id}?new=1`);
    } catch (err) {
      if ((err as Error)?.name === "AbortError" || (err instanceof ApiClientError && (err.isNetwork || err.status >= 500))) {
        setPlaceError({ kind: err instanceof ApiClientError && err.isNetwork ? "offline" : "unconfirmed", text: err instanceof ApiClientError && err.isNetwork ? t("cart.notSent") : t("cart.notConfirmed") });
      } else if (err instanceof ApiClientError && (err.code === "PRICE_CHANGED" || err.code === "CART_INVALID")) {
        const q = (err.details as { quote?: SerializedQuote })?.quote;
        if (q) setQuote(q);
        setPriceChanged(true);
        if (err.code === "CART_INVALID") setReviewOpen(false);
      } else if (err instanceof ApiClientError && err.code === "REWARD_INVALID") {
        cart.setRewardId(null);
        setPlaceError({ kind: "message", text: err.message });
      } else {
        setPlaceError({ kind: "message", text: err instanceof ApiClientError ? err.message : String(err) });
      }
    } finally {
      clearTimeout(timeout);
      setPlacing(false);
    }
  }

  if (cart.lines.length === 0)
    return <EmptyState title={t("cart.empty")} icon="🛒" action={<Link href="/menu"><Button>{t("cart.browse")}</Button></Link>} />;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">{t("cart.title")}</h1>
        <button onClick={cart.clear} className="text-sm font-semibold text-muted underline underline-offset-2">
          {t("cart.clear")}
        </button>
      </div>
      {flash && <Notice tone="blue">{flash}</Notice>}

      <ul className="space-y-3">
        {cart.lines.map((l, idx) => {
          const priced = quote?.lines.find((q) => q.index === idx);
          const issue = issueByIndex.get(idx);
          return (
            <li key={l.key} className={cx("rounded-2xl bg-white p-3 shadow-soft", issue && "ring-2 ring-red-300")}>
              <div className="flex gap-3">
                <FoodImage src={l.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-1.5">
                    <span className="mt-0.5"><DietMark diet={priced?.dietType ?? l.dietType} size={14} /></span>
                    <h3 className="font-semibold leading-snug">{priced?.nameI18n?.[locale] ?? l.name}</h3>
                  </div>
                  {l.optionLabels.length > 0 && <p className="mt-0.5 text-xs text-muted">{l.optionLabels.join(" · ")}</p>}
                  {l.notes && <p className="mt-0.5 text-xs italic text-muted">“{l.notes}”</p>}
                  {issue && (
                    <p className="mt-1 text-xs font-semibold text-red-700" role="alert">
                      {t("cart.issue")}: {issue.message}
                    </p>
                  )}
                </div>
                <div className="text-right text-sm font-semibold tabular-nums">{priced ? formatMoney(priced.lineSubtotalPaise) : quoting ? <Skeleton className="h-4 w-12" /> : "—"}</div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <Stepper value={l.quantity} onChange={(q) => cart.setQuantity(l.key, q)} min={0} />
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEditor(l)}>
                    {t("common.edit")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => cart.remove(l.key)}>
                    {t("common.remove")}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <label className="block rounded-2xl bg-white p-3 shadow-soft">
        <span className="text-sm font-semibold">{t("cart.instructions")}</span>
        <textarea
          value={cart.specialInstructions}
          onChange={(e) => cart.setSpecialInstructions(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder={t("cart.instructionsPlaceholder")}
          className="mt-1 w-full resize-none rounded-xl border border-stone-200 p-2 text-sm outline-none focus:border-brand-400"
        />
      </label>

      <section className="rounded-2xl bg-white p-3 shadow-soft">
        <h2 className="text-sm font-semibold">{t("cart.reward")}</h2>
        {!session?.customer.verified ? (
          <p className="mt-1 text-sm text-muted">
            {t("cart.verifyForRewards")}{" "}
            <Link href="/rewards" className="font-semibold text-brand-700 underline">
              {t("nav.rewards")}
            </Link>
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="reward" checked={!cart.rewardId} onChange={() => cart.setRewardId(null)} className="h-4 w-4 accent-brand-600" />
              {t("cart.noReward")}
              {rewards?.balance !== undefined && <span className="ml-auto text-xs text-muted">{rewards.balance} {t("rewards.points")}</span>}
            </label>
            {rewards?.rewards.map((r) => (
              <label key={r.id} className={cx("flex items-center gap-2 text-sm", !r.affordable && "opacity-50")}>
                <input type="radio" name="reward" disabled={!r.affordable} checked={cart.rewardId === r.id} onChange={() => cart.setRewardId(r.id)} className="h-4 w-4 accent-brand-600" />
                <span className="flex-1">{r.name}</span>
                <span className="text-xs text-muted">{t("rewards.cost", { n: r.pointsCost })}</span>
              </label>
            ))}
            {cart.rewardId && quote?.rewardError && <p className="text-xs font-semibold text-red-700">{quote.rewardError.message}</p>}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-soft" aria-busy={quoting}>
        {quoteError && <ErrorNotice message={quoteError} />}
        {quote ? (
          <>
            <PriceBreakdown totals={quote} discountLabel={quote.reward?.name} />
            {quote.estimatedPrepMinutes > 0 && <p className="mt-2 text-xs text-muted">{t("cart.eta", { n: quote.estimatedPrepMinutes })}</p>}
          </>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
        {quoting && <p className="mt-2 text-xs text-muted">{t("cart.calculating")}</p>}
      </section>

      {priceChanged && !reviewOpen && <Notice tone="amber">{t("cart.priceChanged")}</Notice>}

      <div className="sticky bottom-[76px] z-20">
        <Button size="lg" className="w-full shadow-lift" disabled={!canReview} onClick={() => { setPlaceError(null); setReviewOpen(true); }}>
          {t("cart.review")} {quote && `· ${formatMoney(quote.totalPaise)}`}
        </Button>
      </div>

      {reviewOpen && quote && (
        <Sheet
          open
          onClose={() => !placing && setReviewOpen(false)}
          title={t("cart.finalReview")}
          footer={
            <Button size="lg" className="w-full" loading={placing} onClick={placeOrder} disabled={hasIssues}>
              {placing ? t("cart.placing") : t("cart.place", { price: formatMoney(quote.totalPaise) })}
            </Button>
          }
        >
          {priceChanged && <div className="mb-3"><Notice tone="amber">{t("cart.priceChanged")}</Notice></div>}
          {placeError && (
            <div className="mb-3">
              <Notice tone="red">
                <p className="font-semibold">{placeError.text}</p>
              </Notice>
            </div>
          )}
          <ul className="divide-y divide-stone-200 rounded-2xl bg-white px-3 shadow-soft">
            {quote.lines.map((l) => (
              <li key={l.index} className="flex gap-2 py-2.5 text-sm">
                <span className="font-semibold tabular-nums">{l.quantity}×</span>
                <span className="flex-1">
                  <span className="font-semibold">{l.nameI18n?.[locale] ?? l.name}</span>
                  {l.options.length > 0 && <span className="block text-xs text-muted">{l.options.map((o) => o.optionName).join(" · ")}</span>}
                  {l.notes && <span className="block text-xs italic text-muted">“{l.notes}”</span>}
                </span>
                <span className="tabular-nums">{formatMoney(l.lineSubtotalPaise)}</span>
              </li>
            ))}
          </ul>
          {cart.specialInstructions.trim() && (
            <p className="mt-3 rounded-xl bg-sand p-3 text-sm">
              <span className="font-semibold">{t("cart.instructions")}: </span>
              {cart.specialInstructions}
            </p>
          )}
          <div className="mt-4 rounded-2xl bg-white p-4 shadow-soft">
            <PriceBreakdown totals={quote} discountLabel={quote.reward?.name} />
          </div>
          <p className="mt-3 text-sm text-muted">{t("cart.finalNote")}</p>
        </Sheet>
      )}

      {editing && menu && (() => {
        const item = menu.items.find((i) => i.id === editing.menuItemId);
        if (!item) return null;
        return (
          <ItemSheet
            item={item}
            initial={{ quantity: editing.quantity, selections: editing.selections, notes: editing.notes }}
            onClose={() => setEditing(null)}
            onSubmit={(line) => {
              cart.update(editing.key, { ...line });
              setEditing(null);
            }}
          />
        );
      })()}
    </div>
  );
}
