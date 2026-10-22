"use client";

import Link from "next/link";
import { useLiveData } from "@/lib/client/use-live";
import { Skeleton } from "@/components/shared/ui";
import { PageHeader, Stat } from "@/components/admin/kit";
import { formatMoney } from "@/lib/pricing/money";
import { humanize } from "@/components/shared/status";

interface Overview {
  pendingApprovals: number;
  inKitchen: number;
  readyToServe: number;
  unpaidBills: number;
  todayOrders: number;
  todayNetSalesPaise: number;
  openServiceRequests: number;
  unresolvedComplaints: number;
  outbox: { pending: number; failed: number; stuck: number };
  tables: Record<string, number>;
}

export function AdminOverview() {
  const { data } = useLiveData<Overview>("/api/v1/admin/overview", { sseUrl: "/api/v1/staff/events", pollMs: 20_000 });
  if (!data) return <Skeleton className="h-64" />;
  return (
    <div>
      <PageHeader title="Overview" subtitle="Live operations at a glance" />
      {(data.outbox.failed > 0 || data.outbox.stuck > 0) && (
        <div className="mb-4 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert">
          ⚠ {data.outbox.failed} kitchen dispatch(es) failed and {data.outbox.stuck} are stuck.{" "}
          <Link className="font-semibold underline" href="/admin/dispatch">
            Review and retry
          </Link>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href="/staff/supervisor"><Stat label="Pending approvals" value={data.pendingApprovals} tone={data.pendingApprovals ? "amber" : undefined} /></Link>
        <Link href="/staff/kitchen"><Stat label="In kitchen" value={data.inKitchen} /></Link>
        <Link href="/staff/service"><Stat label="Ready to serve" value={data.readyToServe} tone={data.readyToServe ? "green" : undefined} /></Link>
        <Link href="/staff/cashier"><Stat label="Unpaid bills" value={data.unpaidBills} /></Link>
        <Stat label="Orders today" value={data.todayOrders} />
        <Stat label="Net sales today" value={formatMoney(data.todayNetSalesPaise)} hint="Accepted orders, excl. tax" />
        <Link href="/staff/service"><Stat label="Open requests" value={data.openServiceRequests} /></Link>
        <Link href="/admin/feedback"><Stat label="Open complaints" value={data.unresolvedComplaints} tone={data.unresolvedComplaints ? "red" : undefined} /></Link>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {Object.entries(data.tables).map(([k, v]) => (
          <Stat key={k} label={`Tables ${humanize(k)}`} value={v} />
        ))}
      </div>
    </div>
  );
}
