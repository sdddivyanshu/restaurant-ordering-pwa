"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Badge, Button, ErrorNotice, Sheet, Skeleton } from "@/components/shared/ui";
import { Card, Check, PageHeader, SelectField, TextField, rupees, toPaise } from "@/components/admin/kit";
import { formatMoney } from "@/lib/pricing/money";

interface Reward {
  id?: string;
  name: string;
  nameI18n: Record<string, string>;
  description: string | null;
  descriptionI18n: Record<string, string>;
  type: "PERCENT_OFF" | "FIXED_OFF" | "FREE_ITEM";
  pointsCost: number;
  valuePaise: number | null;
  percentBps: number | null;
  maxDiscountPaise: number | null;
  freeMenuItemId: string | null;
  minOrderPaise: number;
  isActive: boolean;
  _count?: { redemptions: number };
}

export function RewardsAdmin() {
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [edit, setEdit] = useState<Reward | null>(null);
  const load = useCallback(() => api<{ rewards: Reward[] }>("/api/v1/admin/rewards").then((r) => setRewards(r.rewards)), []);
  useEffect(() => {
    void load();
    api<{ items: { id: string; name: string }[] }>("/api/v1/public/menu?lang=en").then((m) => setItems(m.items)).catch(() => {});
  }, [load]);
  const describe = (r: Reward) =>
    r.type === "PERCENT_OFF" ? `${(r.percentBps ?? 0) / 100}% off${r.maxDiscountPaise ? ` (max ${formatMoney(r.maxDiscountPaise)})` : ""}` : r.type === "FIXED_OFF" ? `${formatMoney(r.valuePaise ?? 0)} off` : `Free ${items.find((i) => i.id === r.freeMenuItemId)?.name ?? "item"}`;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Rewards"
        subtitle="Points are earned when an order is served and paid; redemptions are validated on the server"
        actions={<Button variant="dark" onClick={() => setEdit({ name: "", nameI18n: {}, description: "", descriptionI18n: {}, type: "FIXED_OFF", pointsCost: 100, valuePaise: 5000, percentBps: null, maxDiscountPaise: null, freeMenuItemId: null, minOrderPaise: 0, isActive: true })}>+ Reward</Button>}
      />
      {!rewards ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rewards.map((r) => (
            <Card key={r.id} title={r.name} actions={<Button size="sm" variant="secondary" onClick={() => setEdit(r)}>Edit</Button>}>
              <p className="text-sm">{describe(r)}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge tone="brand">{r.pointsCost} pts</Badge>
                {r.minOrderPaise > 0 && <Badge>min order {formatMoney(r.minOrderPaise)}</Badge>}
                {!r.isActive && <Badge tone="red">inactive</Badge>}
                <Badge tone="blue">{r._count?.redemptions ?? 0} redemptions</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <RewardEditor initial={edit} items={items} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
    </div>
  );
}

function RewardEditor({ initial, items, onClose, onSaved }: { initial: Reward; items: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState(initial);
  const [value, setValue] = useState(rupees(initial.valuePaise));
  const [pct, setPct] = useState(initial.percentBps != null ? String(initial.percentBps / 100) : "");
  const [cap, setCap] = useState(rupees(initial.maxDiscountPaise));
  const [min, setMin] = useState(rupees(initial.minOrderPaise));
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const body = {
        name: r.name,
        nameI18n: r.nameI18n ?? {},
        description: r.description || null,
        descriptionI18n: r.descriptionI18n ?? {},
        type: r.type,
        pointsCost: Number(r.pointsCost),
        valuePaise: r.type === "FIXED_OFF" ? toPaise(value) : null,
        percentBps: r.type === "PERCENT_OFF" ? Math.round(parseFloat(pct || "0") * 100) : null,
        maxDiscountPaise: r.type === "PERCENT_OFF" && cap ? toPaise(cap) : null,
        freeMenuItemId: r.type === "FREE_ITEM" ? r.freeMenuItemId : null,
        minOrderPaise: toPaise(min),
        isActive: r.isActive,
      };
      if (r.id) await api(`/api/v1/admin/rewards/${r.id}`, { method: "PATCH", body });
      else await api("/api/v1/admin/rewards", { body });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    }
  }
  return (
    <Sheet open onClose={onClose} title={r.id ? `Edit ${initial.name}` : "New reward"} footer={<div className="flex justify-end"><Button variant="dark" onClick={save}>Save</Button></div>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" value={r.name} onChange={(v) => setR({ ...r, name: v })} />
        <TextField label="Name (हिन्दी)" value={r.nameI18n?.hi ?? ""} onChange={(v) => setR({ ...r, nameI18n: { ...r.nameI18n, hi: v } })} />
        <TextField label="Description" value={r.description ?? ""} onChange={(v) => setR({ ...r, description: v })} />
        <TextField label="Description (हिन्दी)" value={r.descriptionI18n?.hi ?? ""} onChange={(v) => setR({ ...r, descriptionI18n: { ...r.descriptionI18n, hi: v } })} />
        <SelectField label="Type" value={r.type} onChange={(v) => setR({ ...r, type: v as Reward["type"] })} options={[{ value: "FIXED_OFF", label: "Fixed amount off" }, { value: "PERCENT_OFF", label: "Percentage off" }, { value: "FREE_ITEM", label: "Free item" }]} />
        <TextField label="Points cost" type="number" min="1" value={r.pointsCost} onChange={(v) => setR({ ...r, pointsCost: Number(v) })} />
        {r.type === "FIXED_OFF" && <TextField label="Discount (₹)" type="number" value={value} onChange={setValue} />}
        {r.type === "PERCENT_OFF" && (
          <>
            <TextField label="Percent off" type="number" value={pct} onChange={setPct} />
            <TextField label="Maximum discount (₹, optional)" type="number" value={cap} onChange={setCap} />
          </>
        )}
        {r.type === "FREE_ITEM" && <SelectField label="Free item" value={r.freeMenuItemId ?? ""} onChange={(v) => setR({ ...r, freeMenuItemId: v })} options={[{ value: "", label: "Choose…" }, ...items.map((i) => ({ value: i.id, label: i.name }))]} />}
        <TextField label="Minimum order (₹)" type="number" value={min} onChange={setMin} />
        <Check label="Active" checked={r.isActive} onChange={(v) => setR({ ...r, isActive: v })} />
      </div>
      {error && <div className="mt-3"><ErrorNotice message={error} /></div>}
    </Sheet>
  );
}
