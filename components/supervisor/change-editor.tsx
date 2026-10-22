"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Button, ErrorNotice, Notice, Sheet, Stepper } from "@/components/shared/ui";
import { ItemSheet } from "@/components/customer/item-sheet";
import { formatMoney } from "@/lib/pricing/money";
import type { Menu, MenuItemView } from "@/components/customer/menu-types";
import type { StaffOrderView } from "@/lib/orders/views";

interface DraftLine {
  key: string;
  menuItemId: string;
  name: string;
  quantity: number;
  selections: Record<string, string[]>;
  labels: string[];
  notes?: string;
  estUnit: number;
}

const KINDS = ["SUBSTITUTION", "QUANTITY", "CUSTOMIZATION", "REMOVAL", "MIXED"] as const;

/**
 * Supervisor proposal editor. The proposal is never applied directly: the server re-prices it
 * and sends it to the customer, who must explicitly accept before it can be approved.
 */
export function ChangeEditor({ order, onClose, onDone }: { order: StaffOrderView; onClose: () => void; onDone: () => void }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [lines, setLines] = useState<DraftLine[]>(() =>
    order.items.map((i, idx) => {
      const selections: Record<string, string[]> = {};
      for (const o of i.options) if (o.groupId && o.optionId) selections[o.groupId] = [...(selections[o.groupId] ?? []), o.optionId];
      return { key: `o${idx}`, menuItemId: i.menuItemId, name: i.name, quantity: i.quantity, selections, labels: i.options.map((o) => o.optionName), notes: i.notes ?? undefined, estUnit: i.unitPricePaise };
    }),
  );
  const [kind, setKind] = useState<(typeof KINDS)[number]>("SUBSTITUTION");
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState<{ item: MenuItemView; replaceKey?: string } | null>(null);
  const [addId, setAddId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Menu>("/api/v1/public/menu?lang=en").then(setMenu).catch(() => setError("Could not load menu"));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/supervisor/orders/${order.id}`, {
        body: {
          action: "propose-change",
          expectedVersion: order.version,
          kind,
          reason: reason.trim(),
          lines: lines.map((l) => ({
            menuItemId: l.menuItemId,
            quantity: l.quantity,
            selections: Object.entries(l.selections).filter(([, v]) => v.length).map(([groupId, optionIds]) => ({ groupId, optionIds })),
            notes: l.notes,
          })),
        },
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const est = lines.reduce((s, l) => s + l.estUnit * l.quantity, 0);

  return (
    <>
      <Sheet
        open
        wide
        onClose={onClose}
        title={`Propose change · ${order.reference}`}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-600">
              Est. item total {formatMoney(est)} (was {formatMoney(order.subtotalPaise)}) — final price computed by server
            </span>
            <Button variant="dark" loading={busy} disabled={reason.trim().length < 3 || lines.length === 0} onClick={submit}>
              Send to customer
            </Button>
          </div>
        }
      >
        <Notice tone="blue">The customer must accept this proposal. The order will return to you for approval of the accepted version.</Notice>
        <ul className="mt-4 divide-y divide-slate-200 rounded-xl bg-white">
          {lines.map((l) => {
            const item = menu?.items.find((i) => i.id === l.menuItemId);
            return (
              <li key={l.key} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {l.name} {item && !item.available && <span className="ml-1 rounded bg-red-100 px-1.5 text-xs text-red-800">unavailable</span>}
                  </div>
                  {l.labels.length > 0 && <div className="text-xs text-slate-500">{l.labels.join(" · ")}</div>}
                </div>
                <Stepper value={l.quantity} onChange={(q) => setLines((s) => s.map((x) => (x.key === l.key ? { ...x, quantity: q } : x)))} />
                {item && (
                  <Button size="sm" variant="secondary" onClick={() => setPicking({ item, replaceKey: l.key })}>
                    Options
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setLines((s) => s.filter((x) => x.key !== l.key))}>
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex gap-2">
          <select value={addId} onChange={(e) => setAddId(e.target.value)} className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm" aria-label="Add or substitute item">
            <option value="">Add / substitute an item…</option>
            {menu?.items
              .filter((i) => i.available)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} — {formatMoney(i.pricePaise)}
                </option>
              ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!addId}
            onClick={() => {
              const item = menu?.items.find((i) => i.id === addId);
              if (item) setPicking({ item });
            }}
          >
            Add
          </Button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[200px_1fr]">
          <label className="text-sm font-semibold">
            Change type
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 font-normal">
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Message to customer (required)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Mutton is finished — may we substitute butter chicken?" className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2 font-normal" />
          </label>
        </div>
        {error && <div className="mt-3"><ErrorNotice message={error} /></div>}
      </Sheet>
      {picking && (
        <ItemSheet
          item={picking.item}
          initial={picking.replaceKey ? (() => { const l = lines.find((x) => x.key === picking.replaceKey)!; return { quantity: l.quantity, selections: l.selections, notes: l.notes }; })() : undefined}
          onClose={() => setPicking(null)}
          onSubmit={(line) => {
            const draft: DraftLine = { key: picking.replaceKey ?? `n${Date.now()}`, menuItemId: line.menuItemId, name: line.name, quantity: line.quantity, selections: line.selections, labels: line.optionLabels, notes: line.notes, estUnit: line.estUnitPricePaise };
            setLines((s) => (picking.replaceKey ? s.map((x) => (x.key === picking.replaceKey ? draft : x)) : [...s, draft]));
            setPicking(null);
            setAddId("");
          }}
        />
      )}
    </>
  );
}
