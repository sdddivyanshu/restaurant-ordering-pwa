"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useLiveData } from "@/lib/client/use-live";
import { cx } from "@/components/shared/ui";
import { LiveDot, formatTime } from "@/components/shared/status";
import { PromptModal } from "@/components/staff/prompt-modal";

interface Ticket {
  id: string;
  orderId: string;
  orderRef: string;
  tableLabel: string;
  status: "QUEUED" | "PREPARING" | "READY" | "COMPLETED" | "CANCEL_REQUESTED" | "CANCELLED";
  priority: number;
  targetMinutes: number;
  flag: "NONE" | "DELAYED" | "SHORTAGE" | "ISSUE";
  flagNote: string | null;
  notes: string | null;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  isDelayed: boolean;
  prepMinutes: number;
  allergenAlerts: string[];
  items: { id: string; name: string; quantity: number; modifiers: string[]; notes: string | null; allergens: string[]; dietType: string }[];
}

interface Board {
  active: Ticket[];
  recent: Ticket[];
  counts: { queued: number; preparing: number; ready: number; cancelRequested: number };
  targetMinutes: number;
}

type Sort = "oldest" | "prep" | "priority";

function elapsed(from: string, now: number) {
  const m = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60_000));
  return `${m} min`;
}

export function KitchenBoard() {
  const { data, error, state, refresh } = useLiveData<Board>("/api/v1/kitchen/tickets", { sseUrl: "/api/v1/staff/events", fallbackPollMs: 4000 });
  const [sort, setSort] = useState<Sort>("oldest");
  const [showRecent, setShowRecent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flagFor, setFlagFor] = useState<{ ticket: Ticket; flag: "DELAYED" | "SHORTAGE" | "ISSUE" } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function act(ticketId: string, body: Record<string, unknown>) {
    setBusy(`${ticketId}:${body.action}`);
    setErr(null);
    try {
      await api(`/api/v1/kitchen/tickets/${ticketId}`, { body });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : String(e));
      await refresh();
      throw e;
    } finally {
      setBusy(null);
    }
  }

  const tickets = useMemo(() => {
    const list = [...(data?.active ?? [])].filter((t) => t.status !== "READY");
    if (sort === "prep") list.sort((a, b) => b.prepMinutes - a.prepMinutes);
    else if (sort === "priority") list.sort((a, b) => Number(b.isDelayed) - Number(a.isDelayed) || b.priority - a.priority || +new Date(a.createdAt) - +new Date(b.createdAt));
    else list.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    return list;
  }, [data, sort]);
  const ready = (data?.active ?? []).filter((t) => t.status === "READY");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Kitchen</h1>
        {data && (
          <div className="flex gap-2 text-sm font-bold">
            <span className="rounded-lg bg-sky-700 px-3 py-1">New {data.counts.queued}</span>
            <span className="rounded-lg bg-amber-600 px-3 py-1">Cooking {data.counts.preparing}</span>
            <span className="rounded-lg bg-emerald-700 px-3 py-1">Ready {data.counts.ready}</span>
            {data.counts.cancelRequested > 0 && <span className="rounded-lg bg-red-700 px-3 py-1">Cancel? {data.counts.cancelRequested}</span>}
          </div>
        )}
        <span className="text-sm text-zinc-400">Target {data?.targetMinutes ?? "—"} min</span>
        <div className="ml-auto flex items-center gap-3">
          <label className="text-sm">
            Sort{" "}
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 rounded-lg bg-zinc-800 px-2 text-zinc-100">
              <option value="oldest">Oldest first</option>
              <option value="prep">Longest prep</option>
              <option value="priority">Priority / delayed</option>
            </select>
          </label>
          <button onClick={() => setShowRecent((v) => !v)} className="h-9 rounded-lg bg-zinc-800 px-3 text-sm font-semibold">
            {showRecent ? "Hide" : "Show"} completed
          </button>
          <LiveDot state={state} />
        </div>
      </div>
      {(err || (error && !data)) && <div className="mb-3 rounded-lg bg-red-900 p-3 text-sm">{err ?? error?.message}</div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {tickets.map((t) => {
          const tone =
            t.status === "CANCEL_REQUESTED" ? "border-red-500 bg-red-950" : t.isDelayed ? "border-red-500 bg-zinc-900" : t.status === "PREPARING" ? "border-amber-500 bg-zinc-900" : "border-sky-500 bg-zinc-900";
          return (
            <article key={t.id} className={cx("flex flex-col rounded-2xl border-2", tone)} data-testid={`ticket-${t.orderRef}`}>
              <header className="flex items-start justify-between gap-2 border-b border-zinc-800 p-3">
                <div>
                  <div className="text-3xl font-black leading-none">{t.tableLabel}</div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {t.orderRef} · {formatTime(t.createdAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cx("text-2xl font-bold tabular-nums", t.isDelayed ? "text-red-400" : "text-zinc-100")}>{elapsed(t.startedAt ?? t.createdAt, now)}</div>
                  <div className="text-xs text-zinc-400">
                    {t.status === "QUEUED" ? "NEW" : t.status === "PREPARING" ? "COOKING" : "CANCEL REQUESTED"} · target {t.targetMinutes}m
                  </div>
                </div>
              </header>
              {t.allergenAlerts.length > 0 && (
                <div className="bg-red-700 px-3 py-1.5 text-sm font-bold uppercase tracking-wide" role="alert">
                  ⚠ Allergens: {t.allergenAlerts.join(", ")}
                </div>
              )}
              <ul className="flex-1 space-y-2 p-3">
                {t.items.map((i) => (
                  <li key={i.id}>
                    <div className="flex gap-2 text-lg font-bold leading-snug">
                      <span className="tabular-nums text-amber-300">{i.quantity}×</span>
                      <span>{i.name}</span>
                      {i.dietType === "NON_VEG" && <span className="text-xs text-red-300">NV</span>}
                    </div>
                    {i.modifiers.length > 0 && <div className="ml-7 text-sm text-zinc-300">{i.modifiers.join(" · ")}</div>}
                    {i.notes && <div className="ml-7 text-sm font-semibold text-amber-200">“{i.notes}”</div>}
                  </li>
                ))}
              </ul>
              {t.notes && <div className="mx-3 mb-3 rounded-lg bg-amber-900/60 p-2 text-sm font-semibold text-amber-100">📝 {t.notes}</div>}
              {t.flag !== "NONE" && (
                <div className="mx-3 mb-3 rounded-lg bg-orange-900/70 p-2 text-sm">
                  🚩 {t.flag}: {t.flagNote}{" "}
                  <button className="ml-1 underline" onClick={() => act(t.id, { action: "clear-flag" }).catch(() => {})}>
                    clear
                  </button>
                </div>
              )}
              <footer className="grid gap-2 border-t border-zinc-800 p-3">
                {t.status === "QUEUED" && (
                  <button disabled={!!busy} onClick={() => act(t.id, { action: "start" }).catch(() => {})} className="h-14 rounded-xl bg-amber-500 text-lg font-black text-black disabled:opacity-50">
                    START
                  </button>
                )}
                {t.status === "PREPARING" && (
                  <button disabled={!!busy} onClick={() => act(t.id, { action: "ready" }).catch(() => {})} className="h-14 rounded-xl bg-emerald-500 text-lg font-black text-black disabled:opacity-50">
                    READY
                  </button>
                )}
                {t.status === "CANCEL_REQUESTED" && (
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => act(t.id, { action: "confirm-cancel" }).catch(() => {})} className="h-12 rounded-xl bg-red-600 font-bold">
                      Stopped — cancel
                    </button>
                    <button onClick={() => act(t.id, { action: "continue" }).catch(() => {})} className="h-12 rounded-xl bg-zinc-700 font-bold">
                      Too late — continue
                    </button>
                  </div>
                )}
                {(t.status === "QUEUED" || t.status === "PREPARING") && (
                  <div className="grid grid-cols-3 gap-2 text-xs font-semibold">
                    {(["DELAYED", "SHORTAGE", "ISSUE"] as const).map((f) => (
                      <button key={f} onClick={() => setFlagFor({ ticket: t, flag: f })} className="h-9 rounded-lg bg-zinc-800 hover:bg-zinc-700">
                        {f === "DELAYED" ? "Delay" : f === "SHORTAGE" ? "Shortage" : "Issue"}
                      </button>
                    ))}
                  </div>
                )}
              </footer>
            </article>
          );
        })}
        {data && tickets.length === 0 && <div className="col-span-full rounded-2xl border-2 border-dashed border-zinc-700 p-12 text-center text-zinc-400">No active tickets. Approved orders appear here automatically.</div>}
      </div>

      {ready.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-bold text-emerald-400">Ready for pickup ({ready.length})</h2>
          <div className="flex flex-wrap gap-2">
            {ready.map((t) => (
              <span key={t.id} className="rounded-xl border border-emerald-600 bg-emerald-950 px-4 py-2 font-bold">
                {t.tableLabel} · {t.orderRef} · {elapsed(t.readyAt ?? t.createdAt, now)}
              </span>
            ))}
          </div>
        </section>
      )}

      {showRecent && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-bold text-zinc-300">Recently completed</h2>
          <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {(data?.recent ?? []).map((t) => (
              <li key={t.id} className="rounded-xl bg-zinc-900 p-3">
                <span className="font-bold">{t.tableLabel}</span> · {t.orderRef} · {t.status === "CANCELLED" ? "cancelled" : "served"} {formatTime(t.completedAt)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {flagFor && (
        <PromptModal
          title={`${flagFor.flag === "DELAYED" ? "Report delay" : flagFor.flag === "SHORTAGE" ? "Report shortage" : "Report issue"} · ${flagFor.ticket.tableLabel}`}
          label="Message to supervisor"
          minLength={2}
          confirmLabel="Send to supervisor"
          options={flagFor.flag === "SHORTAGE" ? ["Out of an ingredient", "Only partial quantity available"] : flagFor.flag === "DELAYED" ? ["~10 min extra", "Tandoor backed up"] : ["Need clarification on order"]}
          onConfirm={(note) => act(flagFor.ticket.id, { action: "flag", flag: flagFor.flag, note })}
          onClose={() => setFlagFor(null)}
        />
      )}
    </div>
  );
}
