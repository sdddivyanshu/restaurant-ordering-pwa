"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiClientError, newIdempotencyKey } from "@/lib/client/api";
import { useLiveData } from "@/lib/client/use-live";
import { Badge, Button, ErrorNotice, Notice, Skeleton, cx } from "@/components/shared/ui";
import { LiveDot, OrderStatusBadge, PaymentStatusBadge, formatDateTime, humanize } from "@/components/shared/status";
import { PriceBreakdown } from "@/components/customer/price-breakdown";
import { PromptModal } from "@/components/staff/prompt-modal";
import { formatMoney } from "@/lib/pricing/money";
import type { StaffOrderView } from "@/lib/orders/views";

interface Bills {
  acceptedMethods: string[];
  bills: { id: string; reference: string; tableLabel: string; customerName: string; status: string; paymentStatus: string; totalPaise: number; duePaise: number; paidPaise: number; submittedAt: string; isDemo: boolean }[];
}

const METHOD_LABEL: Record<string, string> = { CASH: "Cash", UPI_MANUAL: "UPI (manual)", CARD_AT_COUNTER: "Card at counter", OTHER: "Other" };
const toPaise = (v: string) => Math.round(parseFloat(v || "0") * 100);

export function CashierBoard({ canAdjust }: { canAdjust: boolean }) {
  const [filter, setFilter] = useState<"outstanding" | "paid" | "all">("outstanding");
  const [q, setQ] = useState("");
  const list = useLiveData<Bills>(`/api/v1/cashier/bills?filter=${filter}${q ? `&q=${encodeURIComponent(q)}` : ""}`, { sseUrl: "/api/v1/staff/events" });
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="grid gap-5 lg:grid-cols-[420px_minmax(0,1fr)]">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Bills</h1>
          <LiveDot state={list.state} />
        </div>
        <div className="mb-3 flex gap-2">
          {(["outstanding", "paid", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold", filter === f ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200")}>
              {humanize(f)}
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ref or table" aria-label="Search bills" className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm" />
        </div>
        {!list.data ? (
          <Skeleton className="h-64" />
        ) : (
          <ul className="space-y-2">
            {list.data.bills.map((b) => (
              <li key={b.id}>
                <button onClick={() => setSelected(b.id)} className={cx("flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left shadow-sm ring-1", selected === b.id ? "ring-2 ring-slate-900" : "ring-slate-200")}>
                  <span className="rounded-lg bg-slate-900 px-2.5 py-1 font-bold text-white">{b.tableLabel}</span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold">{b.reference}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {b.customerName} · {humanize(b.status)}
                    </span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="block font-bold tabular-nums">{formatMoney(b.duePaise > 0 ? b.duePaise : b.totalPaise)}</span>
                    <PaymentStatusBadge status={b.paymentStatus} />
                  </span>
                </button>
              </li>
            ))}
            {list.data.bills.length === 0 && <li className="rounded-xl bg-white p-6 text-center text-sm text-slate-500">No bills here.</li>}
          </ul>
        )}
      </section>
      <section>{selected ? <BillDetail key={selected} id={selected} methods={list.data?.acceptedMethods ?? []} canAdjust={canAdjust} onChange={list.refresh} /> : <div className="rounded-2xl border-2 border-dashed border-slate-300 p-16 text-center text-slate-500">Select a bill to record payment.</div>}</section>
    </div>
  );
}

function BillDetail({ id, methods, canAdjust, onChange }: { id: string; methods: string[]; canAdjust: boolean; onChange: () => void }) {
  const { data, refresh, error } = useLiveData<{ order: StaffOrderView }>(`/api/v1/cashier/bills/${id}`, { sseUrl: "/api/v1/staff/events" });
  const [method, setMethod] = useState(methods[0] ?? "CASH");
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [adjust, setAdjust] = useState<"DISCOUNT" | "CORRECTION" | "REFUND" | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [voidId, setVoidId] = useState<string | null>(null);
  const o = data?.order;

  useEffect(() => {
    if (o) setAmount((o.bill.duePaise / 100).toFixed(2));
  }, [o?.bill.duePaise]); // eslint-disable-line react-hooks/exhaustive-deps

  async function record() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ duplicate: boolean }>("/api/v1/cashier/payments", { body: { orderId: id, amountPaise: toPaise(amount), method, externalReference: ref || undefined, idempotencyKey: key } });
      setMsg({ tone: "green", text: res.duplicate ? "Already recorded (duplicate submission ignored)." : "Payment recorded." });
      setKey(newIdempotencyKey());
      setRef("");
      await refresh();
      onChange();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof ApiClientError ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  if (error && !o) return <ErrorNotice message={error.message} onRetry={refresh} />;
  if (!o) return <Skeleton className="h-96" />;
  const billable = ["APPROVED", "QUEUED", "PREPARING", "READY", "SERVED", "CANCEL_REQUESTED"].includes(o.status);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold">
            {o.reference} · {o.tableLabel}
          </h2>
          <OrderStatusBadge status={o.status} />
          <PaymentStatusBadge status={o.paymentStatus} />
          {o.isDemo && <Badge>demo</Badge>}
          {o.receiptNumber && (
            <Link href={`/staff/receipt/${o.id}`} className="ml-auto text-sm font-semibold underline" target="_blank">
              Receipt {o.receiptNumber}
            </Link>
          )}
        </div>
        <p className="text-sm text-slate-500">
          {o.customerName} · {o.customerPhone} · {formatDateTime(o.submittedAt)}
        </p>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {o.items.map((i) => (
            <li key={i.id} className="flex justify-between py-1.5">
              <span>
                {i.quantity}× {i.name}
                {i.options.length > 0 && <span className="text-slate-500"> ({i.options.map((x) => x.optionName).join(", ")})</span>}
              </span>
              <span className="tabular-nums">{formatMoney(i.lineSubtotalPaise)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-3">
            <PriceBreakdown totals={o} discountLabel={o.reward?.name} />
          </div>
          <dl className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between"><dt>Bill total</dt><dd className="tabular-nums">{formatMoney(o.bill.totalPaise)}</dd></div>
            {o.bill.adjustmentDiscountPaise > 0 && <div className="flex justify-between text-emerald-700"><dt>Discounts/corrections</dt><dd>−{formatMoney(o.bill.adjustmentDiscountPaise)}</dd></div>}
            <div className="flex justify-between"><dt>Collected</dt><dd className="tabular-nums">{formatMoney(o.bill.paidPaise)}</dd></div>
            {o.bill.refundedPaise > 0 && <div className="flex justify-between text-violet-700"><dt>Refunded</dt><dd>−{formatMoney(o.bill.refundedPaise)}</dd></div>}
            <div className="flex justify-between border-t border-slate-200 pt-1 text-lg font-bold"><dt>Due</dt><dd className="tabular-nums" data-testid="bill-due">{formatMoney(o.bill.duePaise)}</dd></div>
          </dl>
        </div>
      </div>

      {billable && o.bill.duePaise > 0 && (
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h3 className="font-bold">Record payment</h3>
          <div className="flex flex-wrap gap-2">
            {methods.map((m) => (
              <button key={m} onClick={() => setMethod(m)} aria-pressed={method === m} className={cx("rounded-lg px-3 py-2 text-sm font-semibold", method === m ? "bg-slate-900 text-white" : "bg-slate-100")}>
                {METHOD_LABEL[m] ?? m}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Amount received (₹)
              <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-lg font-normal tabular-nums" />
            </label>
            <label className="text-sm font-semibold">
              Reference (UPI txn / card slip)
              <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 font-normal" />
            </label>
          </div>
          <p className="text-xs text-slate-500">Recorded manually by the cashier — not verified by a payment gateway.</p>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <Button variant="success" size="lg" loading={busy} disabled={toPaise(amount) <= 0} onClick={record} data-testid="record-payment">
            Record {formatMoney(toPaise(amount))}
          </Button>
        </div>
      )}
      {!billable && <Notice tone="amber">This order is {humanize(o.status)} — payments can only be recorded for approved orders.</Notice>}

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h3 className="font-bold">Payment history</h3>
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {o.payments.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2">
              <span className={cx("flex-1", p.status === "VOIDED" && "text-slate-400 line-through")}>
                {formatDateTime(p.at)} · {METHOD_LABEL[p.method] ?? p.method} {p.externalReference && `· ${p.externalReference}`} · {p.recordedBy}
              </span>
              <span className="font-semibold tabular-nums">{formatMoney(p.amountPaise)}</span>
              {p.status === "RECORDED" && canAdjust && (
                <button className="text-xs font-semibold text-red-700 underline" onClick={() => setVoidId(p.id)}>
                  Void
                </button>
              )}
              {p.status === "VOIDED" && <Badge tone="red">void: {p.voidReason}</Badge>}
            </li>
          ))}
          {o.adjustments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-2 text-slate-600">
              <span className="flex-1">
                {formatDateTime(a.at)} · {humanize(a.type)} · {a.reason} · {a.by}
              </span>
              <span className="tabular-nums">{formatMoney(a.amountPaise)}</span>
            </li>
          ))}
          {o.payments.length + o.adjustments.length === 0 && <li className="py-2 text-slate-500">No payments yet.</li>}
        </ul>
        {canAdjust && (
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <label className="text-sm font-semibold">
              Adjustment (₹)
              <input type="number" step="0.01" min="0" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} className="mt-1 h-9 w-28 rounded-lg border border-slate-300 px-2 font-normal" />
            </label>
            {billable && (
              <>
                <Button size="sm" variant="secondary" disabled={toPaise(adjustAmount) <= 0} onClick={() => setAdjust("DISCOUNT")}>
                  Discount
                </Button>
                <Button size="sm" variant="secondary" disabled={toPaise(adjustAmount) <= 0} onClick={() => setAdjust("CORRECTION")}>
                  Correction
                </Button>
              </>
            )}
            <Button size="sm" variant="secondary" disabled={toPaise(adjustAmount) <= 0 || o.bill.netPaidPaise <= 0} onClick={() => setAdjust("REFUND")}>
              Refund
            </Button>
          </div>
        )}
      </div>

      {adjust && (
        <PromptModal
          title={`${humanize(adjust)} of ${formatMoney(toPaise(adjustAmount))}`}
          label="Reason (audit-logged)"
          confirmLabel={`Apply ${adjust.toLowerCase()}`}
          danger={adjust === "REFUND"}
          onConfirm={async (reason) => {
            try {
              await api(`/api/v1/cashier/bills/${id}/adjustments`, { body: { type: adjust, amountPaise: toPaise(adjustAmount), reason } });
              setAdjustAmount("");
              await refresh();
              onChange();
            } catch (err) {
              throw new Error(err instanceof ApiClientError ? err.message : String(err));
            }
          }}
          onClose={() => setAdjust(null)}
        />
      )}
      {voidId && (
        <PromptModal
          title="Void payment"
          label="Reason (audit-logged)"
          confirmLabel="Void payment"
          danger
          onConfirm={async (reason) => {
            try {
              await api(`/api/v1/cashier/payments/${voidId}/void`, { body: { reason } });
              await refresh();
              onChange();
            } catch (err) {
              throw new Error(err instanceof ApiClientError ? err.message : String(err));
            }
          }}
          onClose={() => setVoidId(null)}
        />
      )}
    </div>
  );
}
