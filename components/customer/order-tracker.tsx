"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useLiveData } from "@/lib/client/use-live";
import { useI18n } from "@/components/shared/i18n-provider";
import { PriceBreakdown } from "@/components/customer/price-breakdown";
import { FeedbackForm } from "@/components/customer/feedback-form";
import { Button, DietMark, ErrorNotice, Notice, Skeleton, cx } from "@/components/shared/ui";
import { LiveDot, PaymentStatusBadge, formatTime } from "@/components/shared/status";
import { formatMoney } from "@/lib/pricing/money";
import type { CustomerOrderView } from "@/lib/orders/views";
import type { SerializedQuote } from "@/lib/pricing/quote";
import type { MessageKey } from "@/lib/i18n";

interface OrderResponse {
  order: CustomerOrderView;
  upi: { uri: string; upiId: string } | null;
  restaurant: { name: string; address: string | null; gstin: string | null };
}

const STEPS = ["PENDING_APPROVAL", "APPROVED", "PREPARING", "READY", "SERVED"] as const;
const STEP_INDEX: Record<string, number> = {
  PENDING_APPROVAL: 0,
  CHANGE_REQUESTED: 0,
  CUSTOMER_CONFIRMATION_REQUIRED: 0,
  APPROVED: 1,
  QUEUED: 1,
  PREPARING: 2,
  CANCEL_REQUESTED: 2,
  READY: 3,
  SERVED: 4,
};

const BODY: Record<string, MessageKey> = {
  PENDING_APPROVAL: "order.pendingBody",
  APPROVED: "order.approvedBody",
  QUEUED: "order.queuedBody",
  PREPARING: "order.preparingBody",
  READY: "order.readyBody",
  SERVED: "order.servedBody",
  REJECTED: "order.rejectedBody",
  CANCELLED: "order.cancelledBody",
  CANCEL_REQUESTED: "order.cancelRequestedBody",
};

export function OrderTracker({ orderId }: { orderId: string }) {
  const { t, locale } = useI18n();
  const { data, error, loading, state, refresh } = useLiveData<OrderResponse>(`/api/v1/customer/orders/${orderId}`, { sseUrl: "/api/v1/customer/events" });
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(path: string, body: unknown, key: string) {
    setBusy(key);
    setActionError(null);
    try {
      await api(`/api/v1/customer/orders/${orderId}/${path}`, { body });
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? (err.isNetwork ? t("common.offline") : err.message) : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data)
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  if (error && !data) return <div className="p-4"><ErrorNotice message={error.status === 404 ? t("order.notFound") : error.message} onRetry={refresh} retryLabel={t("common.retry")} /></div>;
  if (!data) return null;
  const o = data.order;
  const stepIdx = STEP_INDEX[o.status] ?? -1;
  const terminalBad = o.status === "REJECTED" || o.status === "CANCELLED";
  const pending = o.status === "PENDING_APPROVAL";
  const change = o.changeRequest;
  const changeQuote = change?.quote as (SerializedQuote & { rewardRemoved?: boolean }) | undefined;

  return (
    <div className="space-y-4 p-4">
      <section className={cx("print-area overflow-hidden rounded-3xl p-5 shadow-lift", terminalBad ? "bg-red-800 text-white" : pending ? "bg-amber-50 text-amber-950 ring-1 ring-amber-200" : "bg-brand-700 text-white")}>
        <div className="flex items-center justify-between">
          <p className="text-sm opacity-80">{t("order.reference", { ref: o.reference })}</p>
          <span className="no-print">{state === "live" ? <LiveDot state="live" /> : <LiveDot state={state} />}</span>
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold" data-testid="order-status">
          {pending ? t("order.pendingTitle") : t(`status.${o.status}` as MessageKey)}
        </h1>
        {BODY[o.status] && <p className="mt-2 text-sm opacity-90">{t(BODY[o.status])}</p>}
        {o.estimatedReadyAt && <p className="mt-2 text-sm font-semibold">{t("order.eta", { time: formatTime(o.estimatedReadyAt) })}</p>}
        {o.status === "REJECTED" && o.rejectionReason && <p className="mt-3 rounded-xl bg-white/15 p-3 text-sm">“{o.rejectionReason}”</p>}
        {pending && (
          <div className="mt-4 flex items-center gap-2 text-sm">
            <span className="pulse-ring h-3 w-3 rounded-full bg-brand-500" aria-hidden />
            {t("status.PENDING_APPROVAL")}
          </div>
        )}
        {!terminalBad && (
          <ol className="mt-5 grid grid-cols-5 gap-1" aria-label={t("order.timeline")}>
            {STEPS.map((s, i) => (
              <li key={s} className="text-center">
                <div className={cx("mx-auto h-1.5 rounded-full", i <= stepIdx ? (pending ? "bg-amber-500" : "bg-white") : pending ? "bg-amber-200" : "bg-white/25")} />
                <span className={cx("mt-1.5 block text-[10px] leading-tight", i <= stepIdx ? "font-semibold" : "opacity-60")}>{t(`status.${s === "PREPARING" ? "PREPARING" : s}` as MessageKey)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {actionError && <ErrorNotice message={actionError} />}

      {o.status === "CHANGE_REQUESTED" && o.clarificationNote && (
        <Notice tone="blue">
          <p className="font-semibold">{t("order.clarification")}</p>
          <p className="mt-1">“{o.clarificationNote}”</p>
          <p className="mt-2 text-xs">{t("order.clarificationHelp")}</p>
        </Notice>
      )}

      {o.status === "CUSTOMER_CONFIRMATION_REQUIRED" && change && changeQuote && (
        <section className="rounded-3xl bg-white p-4 shadow-soft ring-2 ring-violet-300" aria-labelledby="chg">
          <h2 id="chg" className="font-display text-xl font-semibold">
            {t("order.changeTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("order.changeBody")}</p>
          <p className="mt-3 rounded-xl bg-violet-50 p-3 text-sm text-violet-950">“{change.reason}”</p>
          <h3 className="mt-4 text-sm font-semibold">{t("order.revised")}</h3>
          <ul className="mt-1 divide-y divide-stone-100 text-sm">
            {changeQuote.lines.map((l) => (
              <li key={l.index} className="flex gap-2 py-2">
                <span className="font-semibold">{l.quantity}×</span>
                <span className="flex-1">
                  {l.nameI18n?.[locale] ?? l.name}
                  {l.options.length > 0 && <span className="block text-xs text-muted">{l.options.map((x) => x.optionName).join(" · ")}</span>}
                </span>
                <span className="tabular-nums">{formatMoney(l.lineSubtotalPaise)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-2xl bg-sand p-3">
            <PriceBreakdown totals={changeQuote} />
            <p className="mt-2 text-xs text-muted">
              {formatMoney(o.totalPaise)} → <strong>{formatMoney(changeQuote.totalPaise)}</strong>
            </p>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button size="lg" loading={busy === "accept"} onClick={() => act("change-response", { changeRequestId: change.id, accept: true }, "accept")}>
              {t("order.acceptChange")}
            </Button>
            <Button size="lg" variant="secondary" loading={busy === "decline"} onClick={() => act("change-response", { changeRequestId: change.id, accept: false }, "decline")}>
              {t("order.declineChange")}
            </Button>
          </div>
        </section>
      )}

      <section className="print-area rounded-3xl bg-white p-4 shadow-soft">
        <div className="hidden print:block">
          <p className="font-display text-xl font-semibold">{data.restaurant.name}</p>
          {data.restaurant.address && <p className="text-xs">{data.restaurant.address}</p>}
          {data.restaurant.gstin && <p className="text-xs">GSTIN {data.restaurant.gstin}</p>}
          <p className="mt-2 text-xs">
            {o.reference} · {o.tableName} · {new Date(o.submittedAt).toLocaleString("en-IN")}
          </p>
        </div>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("order.items")}</h2>
          <span className="text-xs text-muted">{o.tableName}</span>
        </div>
        <ul className="mt-2 divide-y divide-stone-100">
          {o.items.map((i) => (
            <li key={i.id} className="flex gap-2 py-2 text-sm">
              <span className="mt-0.5"><DietMark diet={i.dietType} size={13} /></span>
              <span className="font-semibold tabular-nums">{i.quantity}×</span>
              <span className="flex-1">
                {i.nameI18n?.[locale] ?? i.name}
                {i.options.length > 0 && <span className="block text-xs text-muted">{i.options.map((x) => x.optionName).join(" · ")}</span>}
                {i.notes && <span className="block text-xs italic text-muted">“{i.notes}”</span>}
              </span>
              <span className="tabular-nums">{formatMoney(i.lineSubtotalPaise)}</span>
            </li>
          ))}
        </ul>
        {o.specialInstructions && <p className="mt-2 rounded-xl bg-sand p-2 text-xs">“{o.specialInstructions}”</p>}
        <div className="mt-3 border-t border-stone-100 pt-3">
          <PriceBreakdown
            totals={o}
            discountLabel={o.reward?.name}
            extra={
              o.bill.adjustmentDiscountPaise > 0 ? (
                <div className="flex justify-between text-emerald-700">
                  <dt>{t("cart.discount")}</dt>
                  <dd className="tabular-nums">−{formatMoney(o.bill.adjustmentDiscountPaise)}</dd>
                </div>
              ) : null
            }
          />
        </div>
      </section>

      {!terminalBad && o.status !== "PENDING_APPROVAL" && o.status !== "CHANGE_REQUESTED" && o.status !== "CUSTOMER_CONFIRMATION_REQUIRED" && (
        <section className="print-area rounded-3xl bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t("order.bill")}</h2>
            <PaymentStatusBadge status={o.paymentStatus} label={t(`pay.${o.paymentStatus}` as MessageKey)} />
          </div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">{t("order.paid")}</dt>
              <dd className="tabular-nums">{formatMoney(o.bill.netPaidPaise)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>{t("order.due")}</dt>
              <dd className="tabular-nums">{formatMoney(o.bill.duePaise)}</dd>
            </div>
          </dl>
          {o.receiptNumber && <p className="mt-2 text-xs text-muted">{t("order.receipt", { n: o.receiptNumber })}</p>}
          {o.bill.duePaise > 0 && (
            <div className="no-print mt-3 space-y-2 text-xs text-muted">
              <p>{t("order.payAtCounter")}</p>
              {data.upi && <p>{t("order.upi", { upi: data.upi.upiId })}</p>}
            </div>
          )}
          <Button variant="secondary" size="sm" className="no-print mt-3" onClick={() => window.print()}>
            {t("order.printBill")}
          </Button>
        </section>
      )}

      {o.canGiveFeedback && <FeedbackForm orderId={o.id} items={o.items.map((i) => ({ id: i.id, name: i.nameI18n?.[locale] ?? i.name }))} onDone={refresh} />}
      {o.feedbackSubmitted && <Notice tone="green">{t("feedback.thanks")}</Notice>}

      <div className="no-print flex flex-wrap gap-2">
        {o.canCancel && (
          <Button
            variant="secondary"
            loading={busy === "cancel"}
            onClick={() => {
              if (confirm(t("order.cancelConfirm"))) void act("cancel", {}, "cancel");
            }}
          >
            {t("order.cancel")}
          </Button>
        )}
        <Link href="/menu">
          <Button variant="ghost">{t("order.orderMore")}</Button>
        </Link>
      </div>
    </div>
  );
}
