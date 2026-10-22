"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Badge, Button, ErrorNotice, Sheet, Skeleton, cx } from "@/components/shared/ui";
import { Check, PageHeader, TextField } from "@/components/admin/kit";
import { humanize } from "@/components/shared/status";

interface TableRow {
  id: string;
  label: string;
  name: string;
  seats: number;
  area: string | null;
  isActive: boolean;
  status: string;
  hasQr: boolean;
  qrUrl: string | null;
  qrTokenRotatedAt: string | null;
  openVisit: { openedAt: string } | null;
  activeOrders: number;
}

export function TablesAdmin() {
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [edit, setEdit] = useState<Partial<TableRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printAll, setPrintAll] = useState(false);
  const [v, setV] = useState(0); // cache-buster for QR images after regeneration
  const load = useCallback(() => api<{ tables: TableRow[] }>("/api/v1/admin/tables").then((r) => setTables(r.tables)), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function action(id: string, a: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setError(null);
    try {
      await api(`/api/v1/admin/tables/${id}`, { body: { action: a } });
      setV((x) => x + 1);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    }
  }

  if (printAll && tables)
    return (
      <div>
        <div className="no-print mb-4 flex gap-2">
          <Button variant="dark" onClick={() => window.print()}>Print</Button>
          <Button variant="secondary" onClick={() => setPrintAll(false)}>Back</Button>
        </div>
        <div className="grid grid-cols-2 gap-6 bg-white p-6 sm:grid-cols-3">
          {tables.filter((t) => t.hasQr && t.isActive).map((t) => (
            <div key={t.id} className="break-inside-avoid rounded-2xl border-2 border-slate-900 p-4 text-center">
              <img src={`/api/v1/admin/tables/${t.id}/qr?v=${v}`} alt={`QR code for ${t.name}`} className="mx-auto w-full max-w-[220px]" />
              <p className="mt-2 text-2xl font-black">{t.name}</p>
              <p className="text-sm">Scan to view the menu &amp; order · मेन्यू देखने व ऑर्डर के लिए स्कैन करें</p>
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tables & QR codes"
        subtitle="Each table has an opaque, random QR token. Regenerating or revoking a code immediately invalidates the old one."
        actions={
          <>
            <Button variant="secondary" onClick={() => setPrintAll(true)}>Print all QR codes</Button>
            <Button variant="dark" onClick={() => setEdit({ isActive: true, seats: 4 })}>+ Table</Button>
          </>
        }
      />
      {error && <ErrorNotice message={error} />}
      {!tables ? (
        <Skeleton className="h-96" />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tables.map((t) => (
            <li key={t.id} className={cx("rounded-2xl bg-white p-4 shadow-sm ring-1", t.isActive ? "ring-slate-200" : "opacity-60 ring-slate-300")}>
              <div className="flex gap-3">
                {t.hasQr ? (
                  <img src={`/api/v1/admin/tables/${t.id}/qr?v=${v}`} alt={`QR for ${t.name}`} className="h-28 w-28 rounded-lg ring-1 ring-slate-200" />
                ) : (
                  <div className="grid h-28 w-28 place-items-center rounded-lg bg-slate-100 text-center text-xs text-slate-500">No QR (revoked)</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black">{t.label}</span>
                    <span className="truncate text-sm text-slate-600">{t.name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={t.status === "AVAILABLE" ? "green" : t.status === "OCCUPIED" ? "amber" : "neutral"}>{humanize(t.status)}</Badge>
                    {!t.isActive && <Badge tone="red">Inactive</Badge>}
                    {t.activeOrders > 0 && <Badge tone="blue">{t.activeOrders} active</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {t.seats} seats {t.area && `· ${t.area}`}
                  </p>
                  {t.qrUrl && (
                    <a href={t.qrUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-sky-700 underline" title={t.qrUrl}>
                      Open customer link
                    </a>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                {t.hasQr && (
                  <a href={`/api/v1/admin/tables/${t.id}/qr?download=1`} className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-semibold text-white">
                    Download PNG
                  </a>
                )}
                <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-semibold" onClick={() => setEdit(t)}>Edit</button>
                <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-semibold" onClick={() => action(t.id, "regenerate-qr", `Regenerate the QR for ${t.label}? Printed codes stop working.`)}>
                  {t.hasQr ? "Regenerate QR" : "Issue QR"}
                </button>
                {t.hasQr && <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-semibold text-red-700" onClick={() => action(t.id, "revoke-qr", `Revoke ${t.label}'s QR code?`)}>Revoke</button>}
                {t.openVisit && <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-semibold" onClick={() => action(t.id, "close-visit")}>Close visit</button>}
                {t.status === "NEEDS_CLEANING" && <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 font-semibold" onClick={() => action(t.id, "mark-clean")}>Mark clean</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit && <TableEditor initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
    </div>
  );
}

function TableEditor({ initial, onClose, onSaved }: { initial: Partial<TableRow>; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(initial.label ?? "");
  const [name, setName] = useState(initial.name ?? "");
  const [seats, setSeats] = useState(String(initial.seats ?? 4));
  const [area, setArea] = useState(initial.area ?? "");
  const [active, setActive] = useState(initial.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { label, name, seats: Number(seats), area: area || null, isActive: active };
      if (initial.id) await api(`/api/v1/admin/tables/${initial.id}`, { method: "PATCH", body });
      else await api("/api/v1/admin/tables", { body });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title={initial.id ? `Edit ${initial.label}` : "New table"} footer={<div className="flex justify-end"><Button variant="dark" loading={busy} onClick={save}>Save</Button></div>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Label (e.g. T13)" value={label} onChange={setLabel} maxLength={10} />
        <TextField label="Display name" value={name} onChange={setName} maxLength={40} />
        <TextField label="Seats" type="number" min="1" value={seats} onChange={setSeats} />
        <TextField label="Area" value={area} onChange={setArea} maxLength={40} />
        <Check label="Active (accepting orders)" checked={active} onChange={setActive} />
      </div>
      {error && <div className="mt-3"><ErrorNotice message={error} /></div>}
    </Sheet>
  );
}
