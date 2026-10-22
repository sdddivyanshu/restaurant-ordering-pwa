"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Button, ErrorNotice, Notice, Sheet, Skeleton } from "@/components/shared/ui";
import { Card, Check, PageHeader, SelectField, TextArea, TextField, rupees, toPaise } from "@/components/admin/kit";

interface Tax {
  id: string;
  code: string;
  name: string;
  rateBps: number;
  components: { name: string; rateBps: number }[];
  isDefault: boolean;
  isActive: boolean;
}
interface SettingsData {
  restaurant: { name: string; legalName: string | null; address: string | null; phone: string | null; gstin: string | null; brandColor: string; isDemo: boolean };
  settings: Record<string, unknown> & {
    pricesIncludeTax: boolean;
    roundingMode: string;
    acceptedPaymentMethods: string[];
  };
  taxes: Tax[];
}

const NUM_FIELDS: [string, string, string?][] = [
  ["tableSessionHours", "Table visit length (hours)"],
  ["customerSessionHours", "Customer session length (hours)"],
  ["approvalTargetMinutes", "Approval target (minutes)", "Pending orders older than this are highlighted"],
  ["kitchenTargetMinutes", "Kitchen preparation target (minutes)"],
  ["serviceDupWindowSeconds", "Service request duplicate window (seconds)"],
  ["loyaltyMinRedeemPoints", "Minimum points per reward"],
  ["loyaltyExpiryDays", "Points expire after inactivity (days, 0 = never)"],
  ["customerDataRetentionDays", "Customer data retention (days)"],
];

export function SettingsAdmin() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [r, setR] = useState<SettingsData["restaurant"] | null>(null);
  const [s, setS] = useState<SettingsData["settings"] | null>(null);
  const [earnRupees, setEarnRupees] = useState("10");
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [taxEdit, setTaxEdit] = useState<Partial<Tax> | null>(null);

  const load = () =>
    api<SettingsData>("/api/v1/admin/settings").then((d) => {
      setData(d);
      setR(d.restaurant);
      setS(d.settings);
      setEarnRupees(rupees(d.settings.loyaltyPaisePerPoint as number));
    });
  useEffect(() => {
    void load();
  }, []);

  if (!data || !r || !s) return <Skeleton className="h-96" />;

  async function save() {
    if (!r || !s) return;
    setBusy(true);
    setMsg(null);
    try {
      const settings: Record<string, unknown> = {
        pricesIncludeTax: s.pricesIncludeTax,
        roundingMode: s.roundingMode,
        phoneCountryCode: s.phoneCountryCode,
        loyaltyEnabled: s.loyaltyEnabled,
        loyaltyPaisePerPoint: toPaise(earnRupees),
        acceptedPaymentMethods: s.acceptedPaymentMethods,
        upiId: (s.upiId as string) || null,
        upiPayeeName: (s.upiPayeeName as string) || null,
        receiptFooter: (s.receiptFooter as string) || null,
      };
      for (const [k] of NUM_FIELDS) settings[k] = Number(s[k]);
      await api("/api/v1/admin/settings", {
        method: "PATCH",
        body: { restaurant: { name: r.name, legalName: r.legalName || null, address: r.address || null, phone: r.phone || null, gstin: r.gstin || null, brandColor: r.brandColor }, settings },
      });
      setMsg({ tone: "green", text: "Settings saved." });
      await load();
    } catch (err) {
      setMsg({ tone: "red", text: err instanceof ApiClientError ? `${err.message}${Array.isArray(err.details) ? ": " + (err.details as { path: string; message: string }[]).map((d) => `${d.path} ${d.message}`).join("; ") : ""}` : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const methods = ["CASH", "UPI_MANUAL", "CARD_AT_COUNTER", "OTHER"];

  return (
    <div className="space-y-5">
      <PageHeader title="Settings & tax" actions={<Button variant="dark" loading={busy} onClick={save}>Save settings</Button>} />
      {msg && (msg.tone === "green" ? <Notice tone="green">{msg.text}</Notice> : <ErrorNotice message={msg.text} />)}
      {data.restaurant.isDemo && <Notice tone="amber">This restaurant record is flagged as DEMO data.</Notice>}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Restaurant">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Name" value={r.name} onChange={(v) => setR({ ...r, name: v })} />
            <TextField label="Legal name" value={r.legalName ?? ""} onChange={(v) => setR({ ...r, legalName: v })} />
            <TextField label="Phone" value={r.phone ?? ""} onChange={(v) => setR({ ...r, phone: v })} />
            <TextField label="GSTIN" value={r.gstin ?? ""} onChange={(v) => setR({ ...r, gstin: v })} />
            <div className="sm:col-span-2"><TextArea label="Address" value={r.address ?? ""} onChange={(v) => setR({ ...r, address: v })} /></div>
            <TextField label="Brand colour" type="color" value={r.brandColor} onChange={(v) => setR({ ...r, brandColor: v })} />
            <TextField label="Phone country code" value={String(s.phoneCountryCode ?? "91")} onChange={(v) => setS({ ...s, phoneCountryCode: v })} hint="Default for customer mobile numbers (India = 91)" />
          </div>
        </Card>
        <Card title="Tax & billing" actions={<Button size="sm" variant="secondary" onClick={() => setTaxEdit({ components: [], isActive: true })}>+ Tax rate</Button>}>
          <div className="grid gap-3">
            <Check label="Menu prices include tax" hint="If on, tax is extracted from prices; if off, tax is added on top." checked={s.pricesIncludeTax} onChange={(v) => setS({ ...s, pricesIncludeTax: v })} />
            <SelectField label="Bill rounding" value={s.roundingMode} onChange={(v) => setS({ ...s, roundingMode: v })} options={[{ value: "NEAREST_RUPEE", label: "Round total to nearest ₹1" }, { value: "NONE", label: "No rounding" }]} />
            <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
              {data.taxes.map((t) => (
                <li key={t.id} className="flex items-center justify-between p-2 text-sm">
                  <span>
                    <span className="font-semibold">{t.name}</span> <span className="text-slate-500">({t.code} · {(t.rateBps / 100).toFixed(2)}%{t.isDefault ? " · default" : ""}{!t.isActive ? " · inactive" : ""})</span>
                    <span className="block text-xs text-slate-500">{t.components.map((c) => `${c.name} ${(c.rateBps / 100).toFixed(2)}%`).join(" + ")}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setTaxEdit(t)}>Edit</Button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">Tax rates are configuration, not legal advice — confirm rates with your accountant.</p>
          </div>
        </Card>
        <Card title="Payments">
          <div className="grid gap-2">
            {methods.map((m) => (
              <Check key={m} label={m.replaceAll("_", " ").toLowerCase()} checked={s.acceptedPaymentMethods.includes(m)} onChange={(v) => setS({ ...s, acceptedPaymentMethods: v ? [...s.acceptedPaymentMethods, m] : s.acceptedPaymentMethods.filter((x) => x !== m) })} />
            ))}
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="UPI ID (VPA)" value={(s.upiId as string) ?? ""} onChange={(v) => setS({ ...s, upiId: v })} />
              <TextField label="UPI payee name" value={(s.upiPayeeName as string) ?? ""} onChange={(v) => setS({ ...s, upiPayeeName: v })} />
            </div>
            <TextArea label="Receipt footer" value={(s.receiptFooter as string) ?? ""} onChange={(v) => setS({ ...s, receiptFooter: v })} />
            <p className="text-xs text-slate-500">No payment gateway is integrated: payments are recorded manually and shown as unverified.</p>
          </div>
        </Card>
        <Card title="Operations, loyalty & privacy">
          <div className="grid gap-3 sm:grid-cols-2">
            <Check label="Loyalty programme enabled" checked={Boolean(s.loyaltyEnabled)} onChange={(v) => setS({ ...s, loyaltyEnabled: v })} />
            <TextField label="Spend per point (₹)" type="number" step="0.01" value={earnRupees} onChange={setEarnRupees} hint="Net (pre-tax) spend needed to earn 1 point" />
            {NUM_FIELDS.map(([k, label, hint]) => (
              <TextField key={k} label={label} type="number" value={String(s[k] ?? "")} onChange={(v) => setS({ ...s, [k]: v })} hint={hint} />
            ))}
          </div>
        </Card>
      </div>
      {taxEdit && <TaxEditor initial={taxEdit} onClose={() => setTaxEdit(null)} onSaved={() => { setTaxEdit(null); void load(); }} />}
    </div>
  );
}

function TaxEditor({ initial, onClose, onSaved }: { initial: Partial<Tax>; onClose: () => void; onSaved: () => void }) {
  const [t, setT] = useState({ code: initial.code ?? "", name: initial.name ?? "", rate: initial.rateBps != null ? String(initial.rateBps / 100) : "", components: (initial.components ?? []).map((c) => ({ name: c.name, rate: String(c.rateBps / 100) })), isDefault: initial.isDefault ?? false, isActive: initial.isActive ?? true });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const body = { code: t.code, name: t.name, rateBps: Math.round(parseFloat(t.rate || "0") * 100), components: t.components.filter((c) => c.name).map((c) => ({ name: c.name, rateBps: Math.round(parseFloat(c.rate || "0") * 100) })), isDefault: t.isDefault, isActive: t.isActive };
      if (initial.id) await api(`/api/v1/admin/settings/taxes/${initial.id}`, { method: "PATCH", body });
      else await api("/api/v1/admin/settings/taxes", { body });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    }
  }
  return (
    <Sheet open onClose={onClose} title={initial.id ? "Edit tax rate" : "New tax rate"} footer={<div className="flex justify-end"><Button variant="dark" onClick={save}>Save</Button></div>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Code" value={t.code} onChange={(v) => setT({ ...t, code: v.toUpperCase() })} hint="e.g. GST5" />
        <TextField label="Name" value={t.name} onChange={(v) => setT({ ...t, name: v })} />
        <TextField label="Total rate (%)" type="number" step="0.01" value={t.rate} onChange={(v) => setT({ ...t, rate: v })} />
      </div>
      <h3 className="mt-4 text-sm font-semibold">Components (e.g. CGST + SGST)</h3>
      {t.components.map((c, i) => (
        <div key={i} className="mt-2 grid grid-cols-2 gap-2">
          <TextField label="Name" value={c.name} onChange={(v) => setT({ ...t, components: t.components.map((x, j) => (j === i ? { ...x, name: v } : x)) })} />
          <TextField label="Rate %" type="number" step="0.01" value={c.rate} onChange={(v) => setT({ ...t, components: t.components.map((x, j) => (j === i ? { ...x, rate: v } : x)) })} />
        </div>
      ))}
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => setT({ ...t, components: [...t.components, { name: "", rate: "" }] })}>+ Component</Button>
      <div className="mt-3 grid gap-2">
        <Check label="Default for new dishes" checked={t.isDefault} onChange={(v) => setT({ ...t, isDefault: v })} />
        <Check label="Active" checked={t.isActive} onChange={(v) => setT({ ...t, isActive: v })} />
      </div>
      {error && <div className="mt-3"><ErrorNotice message={error} /></div>}
    </Sheet>
  );
}
