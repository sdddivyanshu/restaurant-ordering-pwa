"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useLiveData } from "@/lib/client/use-live";
import { Badge, Button, DietMark, ErrorNotice, Skeleton, cx } from "@/components/shared/ui";
import { LiveDot, OrderStatusBadge, PaymentStatusBadge, formatTime, humanize, timeAgo } from "@/components/shared/status";
import { PromptModal } from "@/components/staff/prompt-modal";
import { ChangeEditor } from "@/components/supervisor/change-editor";
import { AvailabilityPanel } from "@/components/supervisor/availability-panel";
import { PriceBreakdown } from "@/components/customer/price-breakdown";
import { formatMoney } from "@/lib/pricing/money";
import type { StaffOrderView } from "@/lib/orders/views";

interface BoardData {
  approvalTargetMinutes: number;
  pending: StaffOrderView[];
  inFlight: { id: string; reference: string; tableLabel: string; customerName: string; status: string; paymentStatus: string; approvedAt: string | null; kitchenFlag: string | null; totalPaise: number }[];
  kitchenFlags: { ticketId: string; orderId: string; orderRef: string; tableLabel: string; flag: string; note: string | null; at: string }[];
  outbox: { pending: number; failed: number; stuck: number };
}

type Modal =
  | { kind: "reject" | "flag" | "note" | "cancel" | "resolve"; order: { id: string; reference: string } }
  | { kind: "change"; order: StaffOrderView }
  | null;

export function SupervisorBoard({ permissions }: { permissions: string[] }) {
  const { data, error, loading, state, refresh } = useLiveData<BoardData>("/api/v1/supervisor/orders", { sseUrl: "/api/v1/staff/events", fallbackPollMs: 4000 });
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const can = (p: string) => permissions.includes(p);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  async function action(orderId: string, body: Record<string, unknown>, key = `${orderId}:${body.action}`) {
    setBusy(key);
    setActionError(null);
    try {
      await api(`/api/v1/supervisor/orders/${orderId}`, { body });
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : String(err);
      setActionError(msg);
      await refresh();
      throw new Error(msg);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-96 lg:col-span-2" /><Skeleton className="h-96" /></div>;
  if (error && !data) return <ErrorNotice message={error.message} onRetry={refresh} />;
  if (!data) return null;

  const awaitingDecision = data.pending.filter((o) => o.status === "PENDING_APPROVAL");
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section aria-labelledby="pending-h">
        <div className="mb-3 flex items-center justify-between">
          <h1 id="pending-h" className="text-2xl font-bold">
            Pending approvals <span className="ml-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-base text-amber-900">{awaitingDecision.length}</span>
          </h1>
          <LiveDot state={state} />
        </div>
        {actionError && <div className="mb-3"><ErrorNotice message={actionError} /></div>}
        {data.pending.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">No orders waiting. New orders appear here instantly.</div>
        ) : (
          <ul className="space-y-4">
            {data.pending.map((o) => {
              const waitMin = Math.floor((now - new Date(o.submittedAt).getTime()) / 60_000);
              const late = waitMin >= data.approvalTargetMinutes;
              const unavailable = o.items.filter((i) => !i.availableNow);
              return (
                <li key={o.id} data-testid={`pending-${o.reference}`}>
                  <article className={cx("rounded-2xl bg-white shadow-sm ring-1", late ? "ring-red-300" : "ring-slate-200")}>
                    <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
                      <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-lg font-bold text-white">{o.tableLabel}</span>
                      <div className="min-w-0">
                        <div className="font-bold">{o.reference}</div>
                        <div className="text-xs text-slate-500">
                          {o.customerName} · {o.customerPhone} {o.customerVerified && "✓"} · {formatTime(o.submittedAt)}
                        </div>
                      </div>
                      <OrderStatusBadge status={o.status} />
                      {o.version > 1 && <Badge tone="violet">v{o.version} (customer-accepted change)</Badge>}
                      {o.isDemo && <Badge>demo</Badge>}
                      <span className={cx("ml-auto rounded-lg px-2 py-1 text-sm font-bold tabular-nums", late ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700")} title="Waiting for approval">
                        ⏱ {timeAgo(o.submittedAt, now)}
                      </span>
                    </header>
                    <div className="grid gap-4 p-4 md:grid-cols-[1fr_260px]">
                      <div>
                        <ul className="divide-y divide-slate-100">
                          {o.items.map((i) => (
                            <li key={i.id} className="flex gap-2 py-2">
                              <span className="mt-1"><DietMark diet={i.dietType} size={13} /></span>
                              <span className="w-8 text-lg font-bold tabular-nums">{i.quantity}×</span>
                              <span className="flex-1">
                                <span className="font-semibold">{i.name}</span>
                                {!i.availableNow && <Badge tone="red" className="ml-2">now {humanize(i.unavailableReason ?? "unavailable")}</Badge>}
                                {i.options.length > 0 && <span className="block text-sm text-slate-600">{i.options.map((x) => x.optionName).join(" · ")}</span>}
                                {i.notes && <span className="block text-sm italic text-amber-800">“{i.notes}”</span>}
                                {i.allergens.length > 0 && <span className="block text-xs text-slate-500">Allergens: {i.allergens.join(", ")}</span>}
                              </span>
                              <span className="text-sm tabular-nums text-slate-600">{formatMoney(i.lineSubtotalPaise)}</span>
                            </li>
                          ))}
                        </ul>
                        {o.specialInstructions && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-950">📝 {o.specialInstructions}</p>}
                        {o.clarificationNote && o.status === "CHANGE_REQUESTED" && <p className="mt-2 rounded-lg bg-violet-50 p-2 text-sm text-violet-950">❓ Clarification asked: {o.clarificationNote}</p>}
                        {o.status === "CUSTOMER_CONFIRMATION_REQUIRED" && (
                          <p className="mt-2 rounded-lg bg-violet-50 p-2 text-sm text-violet-950">⏳ Waiting for the customer to accept the proposed change: “{o.changeRequests.find((c) => c.status === "PROPOSED")?.reason}”</p>
                        )}
                        {unavailable.length > 0 && <p className="mt-2 text-sm font-semibold text-red-700">⚠ {unavailable.length} item(s) currently unavailable — consider proposing a substitution.</p>}
                        <details className="mt-3 text-sm">
                          <summary className="cursor-pointer font-semibold text-slate-600">History & notes ({o.history.length + o.notes.length})</summary>
                          <ul className="mt-2 space-y-1 text-slate-600">
                            {o.history.map((h, idx) => (
                              <li key={idx}>
                                {formatTime(h.at)} · {h.from ? `${humanize(h.from)} → ` : ""}
                                <strong>{humanize(h.to)}</strong> · {h.actor}
                                {h.note ? ` — ${h.note}` : ""}
                              </li>
                            ))}
                            {o.notes.map((n) => (
                              <li key={n.id} className="text-slate-800">
                                🗒 {formatTime(n.at)} {n.author}: {n.body}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                      <aside className="space-y-3">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <PriceBreakdown totals={o} discountLabel={o.reward?.name} />
                        </div>
                        <div className="grid gap-2">
                          {o.status === "PENDING_APPROVAL" && can("order.approve") && (
                            <Button
                              variant="success"
                              size="lg"
                              loading={busy === `${o.id}:approve`}
                              onClick={() => action(o.id, { action: "approve", expectedVersion: o.version }).catch(() => {})}
                              data-testid="approve-button"
                            >
                              ✓ Approve &amp; send to kitchen
                            </Button>
                          )}
                          {o.status === "CHANGE_REQUESTED" && can("order.change") && (
                            <Button variant="dark" onClick={() => setModal({ kind: "resolve", order: o })}>
                              Clarified — back to pending
                            </Button>
                          )}
                          {o.status === "CUSTOMER_CONFIRMATION_REQUIRED" && can("order.change") && (
                            <Button variant="secondary" loading={busy === `${o.id}:withdraw-change`} onClick={() => action(o.id, { action: "withdraw-change" }).catch(() => {})}>
                              Withdraw proposal
                            </Button>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            {can("order.change") && o.status !== "CUSTOMER_CONFIRMATION_REQUIRED" && (
                              <Button size="sm" variant="secondary" onClick={() => setModal({ kind: "change", order: o })}>
                                Propose change
                              </Button>
                            )}
                            {can("order.change") && o.status === "PENDING_APPROVAL" && (
                              <Button size="sm" variant="secondary" onClick={() => setModal({ kind: "flag", order: o })}>
                                Ask customer
                              </Button>
                            )}
                            {can("order.approve") && (
                              <Button size="sm" variant="secondary" className="text-red-700" onClick={() => setModal({ kind: "reject", order: o })}>
                                Reject
                              </Button>
                            )}
                            <Button size="sm" variant="secondary" onClick={() => setModal({ kind: "note", order: o })}>
                              Internal note
                            </Button>
                          </div>
                        </div>
                      </aside>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <aside className="space-y-5">
        {(data.outbox.failed > 0 || data.outbox.stuck > 0) && (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert">
            <p className="font-bold">⚠ Kitchen dispatch problem</p>
            <p>
              {data.outbox.failed} failed, {data.outbox.stuck} stuck dispatches. Approved orders are safe and will be retried.
            </p>
            {can("outbox.manage") && (
              <Link href="/admin/dispatch" className="mt-1 inline-block font-semibold underline">
                Review &amp; retry
              </Link>
            )}
          </div>
        )}
        {data.kitchenFlags.length > 0 && (
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-amber-300">
            <h2 className="font-bold">Kitchen reports</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {data.kitchenFlags.map((f) => (
                <li key={f.ticketId} className="rounded-lg bg-amber-50 p-2">
                  <strong>
                    {f.tableLabel} · {f.orderRef}
                  </strong>{" "}
                  <Badge tone={f.flag === "DELAYED" ? "amber" : "red"}>{f.flag}</Badge>
                  <p className="text-amber-950">{f.note}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="font-bold">In progress ({data.inFlight.length})</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.inFlight.map((o) => (
              <li key={o.id} className="flex items-center gap-2 py-2">
                <span className="w-9 font-bold">{o.tableLabel}</span>
                <span className="flex-1">
                  <span className="font-semibold">{o.reference}</span>
                  <span className="block text-xs text-slate-500">{o.customerName}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <OrderStatusBadge status={o.status} />
                  <PaymentStatusBadge status={o.paymentStatus} />
                </span>
                {can("order.cancel") && o.status !== "CANCEL_REQUESTED" && (
                  <button className="text-xs font-semibold text-red-700 underline" onClick={() => setModal({ kind: "cancel", order: o })}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
            {data.inFlight.length === 0 && <li className="py-3 text-slate-500">Nothing in the kitchen right now.</li>}
          </ul>
        </section>
        {can("order.change") && <AvailabilityPanel />}
      </aside>

      {modal?.kind === "reject" && (
        <PromptModal
          title={`Reject ${modal.order.reference}`}
          label="Reason (shown to the customer)"
          confirmLabel="Reject order"
          danger
          options={["Kitchen is closing", "Item(s) unavailable", "Duplicate order", "Please order at the counter"]}
          onConfirm={(reason) => action(modal.order.id, { action: "reject", reason })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "flag" && (
        <PromptModal title={`Ask customer · ${modal.order.reference}`} label="Question for the customer" confirmLabel="Send question" onConfirm={(note) => action(modal.order.id, { action: "flag", note })} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "resolve" && (
        <PromptModal title="Clarification resolved" label="What was agreed? (internal)" minLength={0} confirmLabel="Back to pending" onConfirm={(note) => action(modal.order.id, { action: "resolve-flag", note: note || undefined })} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "note" && <PromptModal title="Internal note" label="Note (staff only)" minLength={1} confirmLabel="Add note" onConfirm={(body) => action(modal.order.id, { action: "note", body })} onClose={() => setModal(null)} />}
      {modal?.kind === "cancel" && (
        <PromptModal
          title={`Cancel ${modal.order.reference}`}
          label="Cancellation reason"
          confirmLabel="Cancel order"
          danger
          onConfirm={(reason) => action(modal.order.id, { action: "cancel", reason })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "change" && <ChangeEditor order={modal.order} onClose={() => setModal(null)} onDone={refresh} />}
    </div>
  );
}
