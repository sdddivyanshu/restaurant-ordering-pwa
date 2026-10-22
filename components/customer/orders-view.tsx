"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useLiveData } from "@/lib/client/use-live";
import { useI18n } from "@/components/shared/i18n-provider";
import { useCart } from "@/components/customer/cart-provider";
import { Button, EmptyState, ErrorNotice, Notice, Skeleton } from "@/components/shared/ui";
import { OrderStatusBadge, PaymentStatusBadge, formatDateTime } from "@/components/shared/status";
import { formatMoney } from "@/lib/pricing/money";
import type { SerializedQuote } from "@/lib/pricing/quote";
import type { MessageKey } from "@/lib/i18n";

interface HistoryResponse {
  verified: boolean;
  total: number;
  rows: {
    id: string;
    reference: string;
    submittedAt: string;
    tableLabel: string;
    status: string;
    paymentStatus: string;
    totalPaise: number;
    items: { name: string; nameI18n: Record<string, string>; quantity: number }[];
    feedbackSubmitted: boolean;
    canReorder: boolean;
  }[];
}

interface CurrentResponse {
  orders: { id: string; reference: string; status: string; paymentStatus: string; totalPaise: number; submittedAt: string }[];
}

export function OrdersView() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const cart = useCart();
  const current = useLiveData<CurrentResponse>("/api/v1/customer/orders", { sseUrl: "/api/v1/customer/events" });
  const history = useLiveData<HistoryResponse>("/api/v1/customer/order-history");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reorder(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await api<{ lines: unknown[]; dropped: { name: string }[]; priceChanged: boolean; quote: SerializedQuote }>(`/api/v1/customer/order-history/${id}/reorder`, { method: "POST" });
      // Reorder builds a NEW cart from today's menu — it never resubmits the old order.
      cart.replaceLines(
        res.quote.lines.map((l) => ({
          menuItemId: l.menuItemId,
          name: l.nameI18n?.[locale] ?? l.name,
          imageUrl: l.imageUrl,
          dietType: l.dietType,
          quantity: l.quantity,
          selections: Object.fromEntries(l.selections.map((s) => [s.groupId, s.optionIds])),
          optionLabels: l.options.map((o) => o.optionName),
          notes: l.notes ?? undefined,
          estUnitPricePaise: l.unitPricePaise,
        })),
      );
      const msg = [t("orders.reorderNote"), res.dropped.length ? t("orders.dropped", { items: res.dropped.map((d) => d.name).join(", ") }) : ""].filter(Boolean).join(" ");
      try {
        sessionStorage.setItem("rs_flash", msg);
      } catch {
        /* ignore */
      }
      router.push("/cart");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-4">
      <section>
        <h1 className="mb-3 font-display text-2xl font-semibold">{t("orders.thisVisit")}</h1>
        {current.loading && !current.data ? (
          <Skeleton className="h-20 w-full" />
        ) : current.data?.orders.length ? (
          <ul className="space-y-2">
            {current.data.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-soft hover:bg-brand-50">
                  <div>
                    <div className="font-semibold">{o.reference}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <OrderStatusBadge status={o.status} label={t(`status.${o.status}` as MessageKey)} />
                      <PaymentStatusBadge status={o.paymentStatus} label={t(`pay.${o.paymentStatus}` as MessageKey)} />
                    </div>
                  </div>
                  <span className="font-semibold tabular-nums">{formatMoney(o.totalPaise)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t("orders.none")}</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-xl font-semibold">{t("orders.history")}</h2>
        {history.data && !history.data.verified && (
          <div className="mb-3">
            <Notice tone="blue">{t("orders.deviceOnly")}</Notice>
          </div>
        )}
        {error && <ErrorNotice message={error} />}
        {history.loading && !history.data ? (
          <Skeleton className="h-32 w-full" />
        ) : !history.data?.rows.length ? (
          <EmptyState title={t("orders.none")} icon="🧾" />
        ) : (
          <ul className="space-y-3">
            {history.data.rows.map((o) => (
              <li key={o.id} className="rounded-2xl bg-white p-4 shadow-soft">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link href={`/orders/${o.id}`} className="font-semibold underline-offset-2 hover:underline">
                      {o.reference}
                    </Link>
                    <p className="text-xs text-muted">
                      {formatDateTime(o.submittedAt)} · {o.tableLabel}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatMoney(o.totalPaise)}</span>
                </div>
                <p className="mt-2 text-sm text-muted">{o.items.map((i) => `${i.quantity}× ${i.nameI18n?.[locale] ?? i.name}`).join(", ")}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <OrderStatusBadge status={o.status} label={t(`status.${o.status}` as MessageKey)} />
                  <PaymentStatusBadge status={o.paymentStatus} label={t(`pay.${o.paymentStatus}` as MessageKey)} />
                  {o.feedbackSubmitted && <span className="text-xs text-muted">★ {t("feedback.thanks").split("!")[0]}</span>}
                  {o.canReorder && (
                    <Button size="sm" variant="secondary" className="ml-auto" loading={busy === o.id} onClick={() => reorder(o.id)}>
                      ↻ {t("orders.reorder")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
