"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Button, ErrorNotice, Notice, Skeleton } from "@/components/shared/ui";
import { Card, Check, PageHeader, Stat } from "@/components/admin/kit";
import { humanize } from "@/components/shared/status";
import { formatMoney } from "@/lib/pricing/money";
import type { getAnalytics } from "@/lib/analytics/service";

type Analytics = Awaited<ReturnType<typeof getAnalytics>>;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const dur = (s: number | null) => (s == null ? "—" : s < 90 ? `${Math.round(s)}s` : `${(s / 60).toFixed(1)} min`);

/** Single-series vertical bars with per-bar hover tooltip; one hue, recessive axis. */
function BarChart({ data, label, format }: { data: { key: string; value: number }[]; label: string; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 640;
  const H = 180;
  const gap = 2;
  const bw = data.length ? (W - gap * (data.length - 1)) / data.length : 0;
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label={label}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="#cbd5e1" strokeWidth="1" />
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * (H - 10));
          const x = i * (bw + gap);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              <rect x={x} y={H - h} width={bw} height={h} rx={Math.min(4, bw / 2)} fill={hover === i ? "#8f3f1f" : "#b4532a"} />
              {(i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 6) === 0) && (
                <text x={x + bw / 2} y={H + 13} textAnchor="middle" fontSize="10" fill="#64748b">
                  {d.key.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && data[hover] && (
        <div className="pointer-events-none absolute top-0 rounded-lg bg-slate-900 px-2 py-1 text-xs text-white" style={{ left: `${((hover + 0.5) / data.length) * 100}%`, transform: "translateX(-50%)" }}>
          {data[hover].key}: {format(data[hover].value)}
        </div>
      )}
    </figure>
  );
}

function HBars({ rows, format }: { rows: { label: string; value: number; sub?: string }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${format(r.value)}`}>
          <div className="flex justify-between">
            <span className="truncate">{r.label}</span>
            <span className="tabular-nums text-slate-600">
              {format(r.value)} {r.sub && <span className="text-xs text-slate-400">{r.sub}</span>}
            </span>
          </div>
          <div className="mt-0.5 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand-600" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
      {rows.length === 0 && <li className="text-slate-500">No data in this range.</li>}
    </ul>
  );
}

export function AnalyticsAdmin() {
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [includeDemo, setIncludeDemo] = useState(true);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDefs, setShowDefs] = useState(false);
  const qs = `from=${from}&to=${to}&includeDemo=${includeDemo}`;

  useEffect(() => {
    setError(null);
    api<Analytics>(`/api/v1/admin/analytics?${qs}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
  }, [qs]);

  const s = data?.summary;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        subtitle="Computed directly from stored orders, payments, feedback and service records"
        actions={
          <>
            <a href={`/api/v1/admin/analytics/export?type=daily&${qs}`}><Button variant="secondary" size="sm">Daily CSV</Button></a>
            <a href={`/api/v1/admin/analytics/export?type=orders&${qs}`}><Button variant="secondary" size="sm">Orders CSV</Button></a>
            <a href={`/api/v1/admin/analytics/export?type=items&${qs}`}><Button variant="secondary" size="sm">Items CSV</Button></a>
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <label className="text-sm font-semibold">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="ml-2 h-9 rounded-lg border border-slate-300 px-2 font-normal" /></label>
        <label className="text-sm font-semibold">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="ml-2 h-9 rounded-lg border border-slate-300 px-2 font-normal" /></label>
        {[7, 30, 90].map((d) => (
          <button key={d} className="h-9 rounded-lg bg-slate-100 px-3 text-sm font-semibold" onClick={() => { setTo(today); setFrom(new Date(Date.now() - (d - 1) * 86_400_000).toISOString().slice(0, 10)); }}>
            Last {d} days
          </button>
        ))}
        <Check label="Include demo data" checked={includeDemo} onChange={setIncludeDemo} />
        <button className="ml-auto text-sm font-semibold underline" onClick={() => setShowDefs((v) => !v)}>Metric definitions</button>
      </div>
      {error && <ErrorNotice message={error} />}
      {data && data.demoOrdersInRange > 0 && (
        <Notice tone="amber">{includeDemo ? `Includes ${data.demoOrdersInRange} seeded DEMO orders in this range. Untick "Include demo data" for live data only.` : `Excluding ${data.demoOrdersInRange} demo orders — showing live data only.`}</Notice>
      )}
      {showDefs && data && (
        <Card title="How metrics are defined">
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            {Object.entries(data.definitions).map(([k, v]) => (
              <div key={k}><dt className="font-semibold">{humanize(k.replace(/([A-Z])/g, "_$1"))}</dt><dd className="text-slate-600">{v}</dd></div>
            ))}
          </dl>
        </Card>
      )}
      {!data || !s ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Net sales" value={formatMoney(s.netSalesPaise)} hint="Excl. tax, after discounts & refunds" />
            <Stat label="Gross sales" value={formatMoney(s.grossSalesPaise)} />
            <Stat label="Accepted orders" value={s.acceptedOrders} hint={`${s.submittedOrders} submitted`} />
            <Stat label="Avg order value" value={formatMoney(s.averageOrderValuePaise)} />
            <Stat label="Discounts" value={formatMoney(s.discountsPaise)} />
            <Stat label="Tax (accepted)" value={formatMoney(s.taxPaise)} />
            <Stat label="Rejected rate" value={pct(s.rejectedRate)} tone={s.rejectedRate > 0.1 ? "amber" : undefined} />
            <Stat label="Cancelled rate" value={pct(s.cancelledRate)} />
          </div>
          <Card title="Net sales before adjustments, per day">
            <BarChart label="Daily net sales" data={data.daily.map((d) => ({ key: d.day, value: d.netBeforeAdjustmentsPaise }))} format={(v) => formatMoney(v)} />
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-slate-600">Table view</summary>
              <table className="mt-2 w-full text-xs">
                <thead className="text-left text-slate-500"><tr><th>Day</th><th>Orders</th><th>Accepted</th><th className="text-right">Gross</th><th className="text-right">Net (pre-adj.)</th></tr></thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={d.day}><td>{d.day}</td><td>{d.orders}</td><td>{d.acceptedOrders}</td><td className="text-right">{formatMoney(d.grossSalesPaise)}</td><td className="text-right">{formatMoney(d.netBeforeAdjustmentsPaise)}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          </Card>
          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Bestselling dishes"><HBars rows={data.bestsellers.map((b) => ({ label: b.name, value: b.quantity, sub: formatMoney(b.revenuePaise) }))} format={(v) => `${v} sold`} /></Card>
            <Card title="Sales by category"><HBars rows={data.categories.map((c) => ({ label: c.name, value: c.revenuePaise }))} format={formatMoney} /></Card>
            <Card title="Popular customizations"><HBars rows={data.customizations.map((c) => ({ label: `${c.group}: ${c.option}`, value: c.count }))} format={(v) => `${v}×`} /></Card>
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <Card title="Service speed">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt>Approval time (avg)</dt><dd className="font-semibold">{dur(data.timings.approvalSeconds)} <span className="text-xs text-slate-400">n={data.timings.approvalSamples}</span></dd></div>
                <div className="flex justify-between"><dt>Kitchen prep (avg)</dt><dd className="font-semibold">{dur(data.timings.prepSeconds)} <span className="text-xs text-slate-400">n={data.timings.prepSamples}</span></dd></div>
                <div className="flex justify-between"><dt>Ready → served (avg)</dt><dd className="font-semibold">{dur(data.timings.readyToServeSeconds)} <span className="text-xs text-slate-400">n={data.timings.readyToServeSamples}</span></dd></div>
                <div className="flex justify-between"><dt>Service request resolution</dt><dd className="font-semibold">{dur(data.serviceRequests.avgResolutionSeconds)}</dd></div>
              </dl>
            </Card>
            <Card title="Payments (accepted orders)">
              <HBars rows={data.payments.map((p) => ({ label: humanize(p.status), value: p.orders, sub: formatMoney(p.amountPaise) }))} format={(v) => `${v} orders`} />
            </Card>
            <Card title="Feedback & loyalty">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt>Responses</dt><dd className="font-semibold">{data.feedback.count}</dd></div>
                <div className="flex justify-between"><dt>Overall / Food / Service</dt><dd className="font-semibold">{[data.feedback.overall, data.feedback.food, data.feedback.service].map((v) => (v == null ? "—" : v.toFixed(1))).join(" / ")} ★</dd></div>
                <div className="flex justify-between"><dt>Complaints</dt><dd className="font-semibold">{data.feedback.complaints}</dd></div>
                <div className="flex justify-between"><dt>Points earned</dt><dd className="font-semibold">{data.loyalty.pointsEarned}</dd></div>
                <div className="flex justify-between"><dt>Points redeemed</dt><dd className="font-semibold">{data.loyalty.pointsRedeemed}</dd></div>
              </dl>
            </Card>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Average overall rating per day">
              <BarChart label="Daily average rating" data={data.feedback.daily.map((d) => ({ key: d.day, value: d.overall }))} format={(v) => `${v.toFixed(2)} ★`} />
            </Card>
            <Card title="Service requests by type">
              <HBars rows={data.serviceRequests.byType.map((r) => ({ label: humanize(r.type), value: r.count, sub: `avg ${dur(r.avgResolutionSeconds)}` }))} format={(v) => `${v}`} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
