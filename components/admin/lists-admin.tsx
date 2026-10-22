"use client";

// Feedback, order search, audit log and kitchen-dispatch (outbox) admin views.

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useLiveData } from "@/lib/client/use-live";
import { Badge, Button, ErrorNotice, Sheet, Skeleton, cx } from "@/components/shared/ui";
import { Card, PageHeader, Pager, Stat } from "@/components/admin/kit";
import { OrderStatusBadge, PaymentStatusBadge, formatDateTime, humanize } from "@/components/shared/status";
import { PromptModal } from "@/components/staff/prompt-modal";
import { PriceBreakdown } from "@/components/customer/price-breakdown";
import { formatMoney } from "@/lib/pricing/money";
import { ORDER_STATUSES } from "@/lib/orders/state-machine";
import type { StaffOrderView } from "@/lib/orders/views";

// ───────── Feedback ─────────

interface FeedbackList {
  total: number;
  page: number;
  pageSize: number;
  averages: { overall: number | null; food: number | null; service: number | null; count: number };
  unresolvedComplaints: number;
  rows: { id: string; orderReference: string; tableLabel: string; customerName: string; overall: number; food: number; service: number; comment: string | null; isComplaint: boolean; status: string; isDemo: boolean; createdAt: string; responses: { body: string; at: string }[] }[];
}

export function FeedbackAdmin({ canResolve }: { canResolve: boolean }) {
  const [filter, setFilter] = useState<"all" | "complaints" | "unresolved">("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FeedbackList | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const load = useCallback(() => api<FeedbackList>(`/api/v1/admin/feedback?filter=${filter}&page=${page}`).then(setData), [filter, page]);
  useEffect(() => {
    void load();
  }, [load]);
  const avg = (v: number | null) => (v == null ? "—" : v.toFixed(2));
  return (
    <div className="space-y-5">
      <PageHeader title="Feedback" subtitle="Private customer feedback — not published anywhere" />
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Responses" value={data.averages.count} />
          <Stat label="Overall" value={`${avg(data.averages.overall)} ★`} />
          <Stat label="Food" value={`${avg(data.averages.food)} ★`} />
          <Stat label="Service" value={`${avg(data.averages.service)} ★`} />
          <Stat label="Open complaints" value={data.unresolvedComplaints} tone={data.unresolvedComplaints ? "red" : undefined} />
        </div>
      )}
      <div className="flex gap-2">
        {(["all", "complaints", "unresolved"] as const).map((f) => (
          <button key={f} onClick={() => { setFilter(f); setPage(1); }} className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold", filter === f ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200")}>
            {humanize(f)}
          </button>
        ))}
      </div>
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {data.rows.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start gap-3 py-3 text-sm">
                <div className="w-40 shrink-0">
                  <div className="font-semibold">{f.orderReference}</div>
                  <div className="text-xs text-slate-500">
                    {f.tableLabel} · {formatDateTime(f.createdAt)}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={f.overall <= 2 ? "red" : f.overall >= 4 ? "green" : "amber"}>Overall {f.overall}★</Badge>
                    <Badge>Food {f.food}★</Badge>
                    <Badge>Service {f.service}★</Badge>
                    {f.isComplaint && <Badge tone="red">complaint</Badge>}
                    {f.status === "RESOLVED" && <Badge tone="green">resolved</Badge>}
                    {f.isDemo && <Badge tone="amber">demo</Badge>}
                  </div>
                  {f.comment && <p className="mt-1">“{f.comment}”</p>}
                  {f.responses.map((r, i) => (
                    <p key={i} className="mt-1 text-xs text-emerald-800">↳ {r.body}</p>
                  ))}
                </div>
                {canResolve && f.status === "NEW" && (
                  <Button size="sm" variant="secondary" onClick={() => setResolving(f.id)}>
                    Resolve
                  </Button>
                )}
              </li>
            ))}
            {data.rows.length === 0 && <li className="py-8 text-center text-slate-500">No feedback in this view.</li>}
          </ul>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </Card>
      )}
      {resolving && (
        <PromptModal
          title="Resolve feedback"
          label="Resolution note (internal)"
          confirmLabel="Mark resolved"
          minLength={2}
          onConfirm={async (note) => {
            try {
              await api(`/api/v1/admin/feedback/${resolving}`, { body: { note } });
              await load();
            } catch (err) {
              throw new Error(err instanceof ApiClientError ? err.message : String(err));
            }
          }}
          onClose={() => setResolving(null)}
        />
      )}
    </div>
  );
}

// ───────── Orders ─────────

interface OrderList {
  total: number;
  page: number;
  pageSize: number;
  rows: { id: string; reference: string; tableLabel: string; customerName: string; status: string; paymentStatus: string; totalPaise: number; submittedAt: string; isDemo: boolean }[];
}

export function OrdersAdmin() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OrderList | null>(null);
  const [open, setOpen] = useState<StaffOrderView | null>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      api<OrderList>(`/api/v1/admin/orders?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${status}` : ""}`).then(setData);
    }, 200);
    return () => clearTimeout(id);
  }, [q, status, page]);
  return (
    <div className="space-y-5">
      <PageHeader title="Orders" subtitle="Search by reference, customer name or table label" />
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="ORD-…, name or T4" aria-label="Search orders" className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status" className="h-10 rounded-lg border border-slate-300 px-2 text-sm">
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
      </div>
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="py-2">Order</th><th>Table</th><th>Customer</th><th>Status</th><th>Payment</th><th className="text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => api<{ order: StaffOrderView }>(`/api/v1/supervisor/orders/${o.id}`).then((r) => setOpen(r.order))}>
                  <td className="py-2">
                    <span className="font-semibold">{o.reference}</span> {o.isDemo && <Badge tone="amber">demo</Badge>}
                    <span className="block text-xs text-slate-500">{formatDateTime(o.submittedAt)}</span>
                  </td>
                  <td>{o.tableLabel}</td>
                  <td>{o.customerName}</td>
                  <td><OrderStatusBadge status={o.status} /></td>
                  <td><PaymentStatusBadge status={o.paymentStatus} /></td>
                  <td className="text-right tabular-nums">{formatMoney(o.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length === 0 && <p className="py-8 text-center text-slate-500">No orders found.</p>}
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </Card>
      )}
      {open && (
        <Sheet open wide onClose={() => setOpen(null)} title={`${open.reference} · ${open.tableLabel}`}>
          <div className="flex flex-wrap gap-2">
            <OrderStatusBadge status={open.status} />
            <PaymentStatusBadge status={open.paymentStatus} />
            <span className="text-sm text-slate-500">
              {open.customerName} · {open.customerPhone}
            </span>
          </div>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {open.items.map((i) => (
              <li key={i.id} className="flex justify-between py-1.5">
                <span>
                  {i.quantity}× {i.name} {i.options.length > 0 && <span className="text-slate-500">({i.options.map((x) => x.optionName).join(", ")})</span>}
                </span>
                <span>{formatMoney(i.lineSubtotalPaise)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-xl bg-white p-3"><PriceBreakdown totals={open} /></div>
          <h3 className="mt-4 font-semibold">Status history</h3>
          <ul className="mt-1 space-y-1 text-sm text-slate-600">
            {open.history.map((h, i) => (
              <li key={i}>
                {formatDateTime(h.at)} · {h.from ? `${humanize(h.from)} → ` : ""}<strong>{humanize(h.to)}</strong> · {h.actor}{h.note ? ` — ${h.note}` : ""}
              </li>
            ))}
          </ul>
          {open.payments.length > 0 && (
            <>
              <h3 className="mt-4 font-semibold">Payments</h3>
              <ul className="mt-1 text-sm">
                {open.payments.map((p) => (
                  <li key={p.id}>
                    {formatDateTime(p.at)} · {humanize(p.method)} · {formatMoney(p.amountPaise)} · {p.status} · by {p.recordedBy}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

// ───────── Audit ─────────

interface AuditList {
  total: number;
  page: number;
  pageSize: number;
  rows: { id: string; actorType: string; actorName: string | null; action: string; entityType: string; entityId: string; before: unknown; after: unknown; meta: unknown; createdAt: string }[];
}

export function AuditAdmin() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditList | null>(null);
  useEffect(() => {
    const id = setTimeout(() => api<AuditList>(`/api/v1/admin/audit?page=${page}&pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ""}`).then(setData), 200);
    return () => clearTimeout(id);
  }, [q, page]);
  return (
    <div className="space-y-5">
      <PageHeader title="Audit log" subtitle="Approvals, rejections, price changes, substitutions, cancellations, payments and configuration changes" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Filter by action (e.g. order.approved, payment, menu.item.price_changed) or entity id" aria-label="Filter audit log" className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" />
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.rows.map((r) => (
              <li key={r.id} className="py-2">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span className="w-36 shrink-0 text-xs text-slate-500">{formatDateTime(r.createdAt)}</span>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.action}</code>
                    <span className="text-slate-600">
                      {r.entityType} · {r.entityId.slice(0, 10)}
                    </span>
                    <span className="ml-auto text-xs font-semibold">{r.actorName ?? r.actorType}</span>
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify({ before: r.before, after: r.after, meta: r.meta }, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}

// ───────── Dispatch / outbox ─────────

interface OutboxList {
  health: { pending: number; failed: number; stuck: number };
  rows: { id: string; type: string; status: string; attempts: number; maxAttempts: number; lastError: string | null; nextAttemptAt: string; createdAt: string; processedAt: string | null; order: { reference: string; status: string } | null }[];
}

export function DispatchAdmin() {
  const [status, setStatus] = useState("");
  const { data, refresh } = useLiveData<OutboxList>(`/api/v1/admin/outbox${status ? `?status=${status}` : ""}`, { sseUrl: "/api/v1/staff/events" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function retry(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/v1/admin/outbox/${id}/retry`, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Kitchen dispatch" subtitle="Transactional outbox: every approved order is delivered to the kitchen exactly once, with automatic retries" />
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Pending" value={data.health.pending} />
          <Stat label="Failed" value={data.health.failed} tone={data.health.failed ? "red" : undefined} />
          <Stat label="Stuck" value={data.health.stuck} tone={data.health.stuck ? "amber" : undefined} />
        </div>
      )}
      {error && <ErrorNotice message={error} />}
      <div className="flex gap-2">
        {["", "PENDING", "FAILED", "DONE"].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cx("rounded-lg px-3 py-1.5 text-sm font-semibold", status === s ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200")}>
            {s ? humanize(s) : "All"}
          </button>
        ))}
      </div>
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="py-2">Created</th><th>Order</th><th>Status</th><th>Attempts</th><th>Last error</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 text-xs">{formatDateTime(r.createdAt)}</td>
                  <td>{r.order ? `${r.order.reference} (${humanize(r.order.status)})` : "—"}</td>
                  <td><Badge tone={r.status === "DONE" ? "green" : r.status === "FAILED" ? "red" : "amber"}>{r.status}</Badge></td>
                  <td className="tabular-nums">{r.attempts}/{r.maxAttempts}</td>
                  <td className="max-w-xs truncate text-xs text-red-700" title={r.lastError ?? ""}>{r.lastError ?? ""}</td>
                  <td className="text-right">{r.status !== "DONE" && <Button size="sm" variant="secondary" loading={busy === r.id} onClick={() => retry(r.id)}>Retry now</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
