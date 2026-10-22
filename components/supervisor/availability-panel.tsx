"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { ErrorNotice } from "@/components/shared/ui";
import type { Menu } from "@/components/customer/menu-types";

/** Quick "86" panel: mark dishes unavailable during service (audited server-side). */
export function AvailabilityPanel() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Menu>("/api/v1/public/menu?lang=en").then(setMenu).catch(() => {});
  useEffect(() => {
    void load();
  }, []);

  async function toggle(id: string, isAvailable: boolean) {
    setError(null);
    try {
      await api(`/api/v1/admin/menu/items/${id}/availability`, { body: { isAvailable } });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    }
  }

  const items = (menu?.items ?? []).filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <details className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <summary className="cursor-pointer font-bold">Item availability</summary>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter dishes" aria-label="Filter dishes" className="mt-3 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm" />
      {error && <div className="mt-2"><ErrorNotice message={error} /></div>}
      <ul className="mt-2 max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
        {items.map((i) => {
          const manualOff = i.unavailableReason === "UNAVAILABLE";
          return (
            <li key={i.id} className="flex items-center justify-between py-1.5">
              <span className={i.available ? "" : "text-slate-400 line-through"}>{i.name}</span>
              {i.available || manualOff ? (
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={i.available} onChange={(e) => toggle(i.id, e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                  {i.available ? "On" : "Off"}
                </label>
              ) : (
                <span className="text-xs text-slate-400">{i.unavailableReason?.toLowerCase().replaceAll("_", " ")}</span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
