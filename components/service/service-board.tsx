"use client";

import { useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useLiveData } from "@/lib/client/use-live";
import { Badge, Button, ErrorNotice, cx } from "@/components/shared/ui";
import { LiveDot, humanize, timeAgo } from "@/components/shared/status";

interface Requests {
  requests: { id: string; tableLabel: string; type: string; message: string | null; priority: "LOW" | "NORMAL" | "HIGH"; status: string; assignedTo: string | null; createdAt: string }[];
}
interface Ready {
  orders: { id: string; reference: string; tableLabel: string; customerName: string; readyAt: string; items: { name: string; quantity: number }[] }[];
}
interface Tables {
  tables: { id: string; label: string; name: string; status: string; activeOrders: number; openVisit: { openedAt: string } | null }[];
}

const ICON: Record<string, string> = { WAITER: "🙋", WATER: "💧", CUTLERY: "🍴", BILL: "🧾", TAKEAWAY_PACKAGING: "🥡", ASSISTANCE: "🆘", CUSTOM: "💬" };

export function ServiceBoard({ canServe }: { canServe: boolean }) {
  const reqs = useLiveData<Requests>("/api/v1/service/requests", { sseUrl: "/api/v1/staff/events", fallbackPollMs: 4000 });
  const ready = useLiveData<Ready>(canServe ? "/api/v1/service/orders" : null, { sseUrl: "/api/v1/staff/events", fallbackPollMs: 4000 });
  const tables = useLiveData<Tables>("/api/v1/admin/tables", { pollMs: 20_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, url: string, body?: unknown) {
    setBusy(key);
    setError(null);
    try {
      await api(url, { method: "POST", body });
      await Promise.all([reqs.refresh(), ready.refresh(), tables.refresh()]);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const open = (reqs.data?.requests ?? []).filter((r) => ["PENDING", "ACKNOWLEDGED", "IN_PROGRESS"].includes(r.status));
  const done = (reqs.data?.requests ?? []).filter((r) => !["PENDING", "ACKNOWLEDGED", "IN_PROGRESS"].includes(r.status));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Floor service</h1>
        <LiveDot state={reqs.state} />
      </div>
      {error && <ErrorNotice message={error} />}
      <div className="grid gap-5 lg:grid-cols-2">
        {canServe && (
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 text-lg font-bold">Ready to serve ({ready.data?.orders.length ?? 0})</h2>
            <ul className="space-y-2">
              {(ready.data?.orders ?? []).map((o) => (
                <li key={o.id} className="flex items-center gap-3 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
                  <span className="rounded-lg bg-emerald-700 px-2.5 py-1 text-lg font-bold text-white">{o.tableLabel}</span>
                  <span className="flex-1 text-sm">
                    <span className="font-semibold">
                      {o.reference} · {o.customerName}
                    </span>
                    <span className="block text-slate-600">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</span>
                    <span className="block text-xs text-slate-500">ready {timeAgo(o.readyAt)} ago</span>
                  </span>
                  <Button variant="success" loading={busy === o.id} onClick={() => run(o.id, `/api/v1/service/orders/${o.id}/serve`)} data-testid={`serve-${o.reference}`}>
                    Served
                  </Button>
                </li>
              ))}
              {ready.data?.orders.length === 0 && <li className="text-sm text-slate-500">Nothing waiting at the pass.</li>}
            </ul>
          </section>
        )}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 text-lg font-bold">Table requests ({open.length})</h2>
          <ul className="space-y-2">
            {open.map((r) => (
              <li key={r.id} className={cx("flex items-center gap-3 rounded-xl p-3 ring-1", r.priority === "HIGH" ? "bg-red-50 ring-red-200" : "bg-slate-50 ring-slate-200")}>
                <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-lg font-bold text-white">{r.tableLabel}</span>
                <span className="flex-1 text-sm">
                  <span className="font-semibold">
                    {ICON[r.type]} {humanize(r.type)}
                  </span>
                  {r.message && <span className="block text-slate-700">“{r.message}”</span>}
                  <span className="block text-xs text-slate-500">
                    {timeAgo(r.createdAt)} ago · {humanize(r.status)}
                    {r.assignedTo ? ` · ${r.assignedTo}` : ""}
                  </span>
                </span>
                {r.priority === "HIGH" && <Badge tone="red">High</Badge>}
                <div className="flex flex-col gap-1">
                  {r.status === "PENDING" && (
                    <Button size="sm" variant="secondary" loading={busy === `${r.id}a`} onClick={() => run(`${r.id}a`, `/api/v1/service/requests/${r.id}`, { action: "acknowledge" })}>
                      On it
                    </Button>
                  )}
                  <Button size="sm" variant="dark" loading={busy === `${r.id}c`} onClick={() => run(`${r.id}c`, `/api/v1/service/requests/${r.id}`, { action: "complete" })}>
                    Done
                  </Button>
                </div>
              </li>
            ))}
            {open.length === 0 && <li className="text-sm text-slate-500">No open requests.</li>}
          </ul>
          {done.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-slate-600">Recently closed ({done.length})</summary>
              <ul className="mt-2 space-y-1 text-slate-600">
                {done.map((r) => (
                  <li key={r.id}>
                    {r.tableLabel} · {humanize(r.type)} · {humanize(r.status)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 text-lg font-bold">Tables</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {(tables.data?.tables ?? []).map((t) => (
            <li key={t.id} className={cx("rounded-xl p-3 text-sm ring-1", t.status === "AVAILABLE" ? "bg-emerald-50 ring-emerald-200" : t.status === "OCCUPIED" ? "bg-amber-50 ring-amber-200" : "bg-slate-100 ring-slate-300")}>
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">{t.label}</span>
                <span className="text-xs">{humanize(t.status)}</span>
              </div>
              {t.activeOrders > 0 && <div className="text-xs text-slate-600">{t.activeOrders} active order(s)</div>}
              <div className="mt-2 flex gap-1">
                {t.openVisit && (
                  <button className="rounded bg-white px-2 py-1 text-xs font-semibold ring-1 ring-slate-300" onClick={() => run(`t${t.id}`, `/api/v1/admin/tables/${t.id}`, { action: "close-visit" })}>
                    Close visit
                  </button>
                )}
                {t.status === "NEEDS_CLEANING" && (
                  <button className="rounded bg-white px-2 py-1 text-xs font-semibold ring-1 ring-slate-300" onClick={() => run(`t${t.id}`, `/api/v1/admin/tables/${t.id}`, { action: "mark-clean" })}>
                    Mark clean
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
