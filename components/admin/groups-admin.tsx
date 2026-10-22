"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Badge, Button, ErrorNotice, Sheet, Skeleton } from "@/components/shared/ui";
import { Card, Check, PageHeader, SelectField, TextField, rupees, toPaise } from "@/components/admin/kit";
import { formatMoney } from "@/lib/pricing/money";

interface Option {
  id?: string;
  name: string;
  nameI18n: Record<string, string>;
  priceDeltaPaise: number;
  isDefault: boolean;
  isAvailable: boolean;
  dietType: string | null;
}
interface Group {
  id?: string;
  key?: string;
  name: string;
  nameI18n: Record<string, string>;
  kind: "VARIANT" | "ADDON" | "CHOICE";
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  options: Option[];
  _count?: { items: number };
}

export function GroupsAdmin() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [editing, setEditing] = useState<Group | null>(null);
  const load = useCallback(() => api<{ groups: Group[] }>("/api/v1/admin/menu/groups").then((r) => setGroups(r.groups)), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Customizations"
        subtitle="Variants (e.g. Regular/Large), add-ons and choices with min/max rules — enforced on both client and server"
        actions={<Button variant="dark" onClick={() => setEditing({ name: "", nameI18n: {}, kind: "ADDON", isRequired: false, minSelect: 0, maxSelect: 1, options: [{ name: "", nameI18n: {}, priceDeltaPaise: 0, isDefault: false, isAvailable: true, dietType: null }] })}>+ New group</Button>}
      />
      {!groups ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.id} title={g.name} actions={<Button size="sm" variant="secondary" onClick={() => setEditing(g)}>Edit</Button>}>
              <div className="mb-2 flex flex-wrap gap-1 text-xs">
                <Badge>{g.kind}</Badge>
                {g.isRequired ? <Badge tone="brand">required</Badge> : <Badge>optional</Badge>}
                <Badge>
                  choose {g.minSelect}–{g.maxSelect}
                </Badge>
                <Badge tone="blue">used by {g._count?.items ?? 0} dishes</Badge>
                {g.nameI18n?.hi && <Badge tone="green">हि: {g.nameI18n.hi}</Badge>}
              </div>
              <ul className="text-sm">
                {g.options.map((o) => (
                  <li key={o.id} className="flex justify-between py-0.5">
                    <span className={o.isAvailable ? "" : "text-slate-400 line-through"}>
                      {o.name} {o.isDefault && "(default)"} {o.dietType && <span className="text-xs text-slate-500">· {o.dietType}</span>}
                    </span>
                    <span className="tabular-nums text-slate-600">{o.priceDeltaPaise ? `+${formatMoney(o.priceDeltaPaise)}` : "—"}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {editing && <GroupEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </div>
  );
}

function GroupEditor({ initial, onClose, onSaved }: { initial: Group; onClose: () => void; onSaved: () => void }) {
  const [g, setG] = useState<Group>({ ...initial, options: initial.options.map((o) => ({ ...o })) });
  const [prices, setPrices] = useState(() => initial.options.map((o) => rupees(o.priceDeltaPaise) || "0"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setOpt = (i: number, patch: Partial<Option>) => setG((s) => ({ ...s, options: s.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: g.name,
        nameI18n: g.nameI18n,
        kind: g.kind,
        isRequired: g.isRequired,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        options: g.options.map((o, i) => ({ id: o.id, name: o.name, nameI18n: o.nameI18n ?? {}, priceDeltaPaise: toPaise(prices[i]), isDefault: o.isDefault, isAvailable: o.isAvailable, dietType: o.dietType || null })),
      };
      if (g.id) await api(`/api/v1/admin/menu/groups/${g.id}`, { method: "PATCH", body });
      else await api("/api/v1/admin/menu/groups", { body });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.message}${Array.isArray(err.details) ? ": " + (err.details as { message: string }[]).map((d) => d.message).join("; ") : ""}` : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open wide onClose={onClose} title={g.id ? `Edit ${initial.name}` : "New customization group"} footer={<div className="flex justify-end"><Button variant="dark" loading={busy} onClick={save}>Save group</Button></div>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Group name" value={g.name} onChange={(v) => setG({ ...g, name: v })} />
        <TextField label="Group name (हिन्दी)" value={g.nameI18n?.hi ?? ""} onChange={(v) => setG({ ...g, nameI18n: { ...g.nameI18n, hi: v } })} lang="hi" />
        <SelectField label="Kind" value={g.kind} onChange={(v) => setG({ ...g, kind: v as Group["kind"] })} options={[{ value: "VARIANT", label: "Variant (size/portion)" }, { value: "ADDON", label: "Add-on" }, { value: "CHOICE", label: "Choice" }]} />
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Min" type="number" min="0" value={g.minSelect} onChange={(v) => setG({ ...g, minSelect: Number(v) })} />
          <TextField label="Max" type="number" min="1" value={g.maxSelect} onChange={(v) => setG({ ...g, maxSelect: Number(v) })} />
        </div>
        <Check label="Required" checked={g.isRequired} onChange={(v) => setG({ ...g, isRequired: v, minSelect: v ? Math.max(1, g.minSelect) : g.minSelect })} />
      </div>
      <h3 className="mt-5 font-semibold">Options</h3>
      <ul className="mt-2 space-y-2">
        {g.options.map((o, i) => (
          <li key={o.id ?? `new${i}`} className="grid items-end gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[1fr_1fr_100px_110px_auto]">
            <TextField label="Option" value={o.name} onChange={(v) => setOpt(i, { name: v })} />
            <TextField label="हिन्दी" value={o.nameI18n?.hi ?? ""} onChange={(v) => setOpt(i, { nameI18n: { ...o.nameI18n, hi: v } })} lang="hi" />
            <TextField label="+ Price ₹" type="number" step="0.01" value={prices[i] ?? "0"} onChange={(v) => setPrices((p) => p.map((x, j) => (j === i ? v : x)))} />
            <SelectField label="Diet change" value={o.dietType ?? ""} onChange={(v) => setOpt(i, { dietType: v || null })} options={[{ value: "", label: "—" }, { value: "EGG", label: "Egg" }, { value: "NON_VEG", label: "Non-veg" }]} />
            <div className="flex flex-col gap-1 text-xs">
              <Check label="Default" checked={o.isDefault} onChange={(v) => setOpt(i, { isDefault: v })} />
              <Check label="Available" checked={o.isAvailable} onChange={(v) => setOpt(i, { isAvailable: v })} />
              <button className="text-left text-red-700 underline" onClick={() => { setG((s) => ({ ...s, options: s.options.filter((_, j) => j !== i) })); setPrices((p) => p.filter((_, j) => j !== i)); }}>Remove</button>
            </div>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => { setG((s) => ({ ...s, options: [...s.options, { name: "", nameI18n: {}, priceDeltaPaise: 0, isDefault: false, isAvailable: true, dietType: null }] })); setPrices((p) => [...p, "0"]); }}>
        + Option
      </Button>
      <p className="mt-2 text-xs text-slate-500">Removed options are archived so past orders keep their details.</p>
      {error && <div className="mt-3"><ErrorNotice message={error} /></div>}
    </Sheet>
  );
}
