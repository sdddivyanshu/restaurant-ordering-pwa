"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Badge, Button, DietMark, ErrorNotice, FoodImage, Sheet, Skeleton } from "@/components/shared/ui";
import { Card, Check, PageHeader, Pager, TextField, TextArea } from "@/components/admin/kit";
import { formatMoney } from "@/lib/pricing/money";

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
  availableFrom: string | null;
  availableTo: string | null;
  itemCount: number;
  translations: { locale: string; name: string; description: string | null }[];
}
interface ItemRow {
  id: string;
  name: string;
  category: string;
  categoryId: string;
  pricePaise: number;
  dietType: "VEG" | "VEGAN" | "EGG" | "NON_VEG";
  isAvailable: boolean;
  isBestseller: boolean;
  imageUrl: string | null;
  locales: string[];
  groups: number;
  allergenInfoVerified: boolean;
}

export function MenuAdmin() {
  const [cats, setCats] = useState<Category[] | null>(null);
  const [items, setItems] = useState<{ rows: ItemRow[]; total: number; page: number; pageSize: number } | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [page, setPage] = useState(1);
  const [editCat, setEditCat] = useState<Partial<Category> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCats = useCallback(() => api<{ categories: Category[] }>("/api/v1/admin/menu/categories").then((r) => setCats(r.categories)), []);
  const loadItems = useCallback(
    () => api<typeof items>(`/api/v1/admin/menu/items?page=${page}&pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ""}${cat ? `&categoryId=${cat}` : ""}`).then(setItems),
    [page, q, cat],
  );
  useEffect(() => {
    void loadCats();
  }, [loadCats]);
  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await Promise.all([loadCats(), loadItems()]);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    }
  }

  async function moveCat(idx: number, dir: -1 | 1) {
    if (!cats) return;
    const ids = cats.map((c) => c.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await run(() => api("/api/v1/admin/menu/reorder", { body: { entity: "category", ids } }));
  }

  async function moveItem(idx: number, dir: -1 | 1) {
    if (!items) return;
    const sameCat = items.rows.filter((r) => r.categoryId === items.rows[idx].categoryId);
    const pos = sameCat.findIndex((r) => r.id === items.rows[idx].id);
    const j = pos + dir;
    if (j < 0 || j >= sameCat.length) return;
    const ids = sameCat.map((r) => r.id);
    [ids[pos], ids[j]] = [ids[j], ids[pos]];
    await run(() => api("/api/v1/admin/menu/reorder", { body: { entity: "item", ids } }));
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Menu" subtitle="Categories, dishes, prices, availability and translations" actions={<Link href="/admin/menu/items/new"><Button variant="dark">+ New dish</Button></Link>} />
      {error && <ErrorNotice message={error} />}
      <Card title="Categories" actions={<Button size="sm" variant="secondary" onClick={() => setEditCat({ isActive: true, translations: [] })}>+ Category</Button>}>
        {!cats ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {cats.map((c, idx) => (
              <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="flex flex-col">
                  <button aria-label="Move up" onClick={() => moveCat(idx, -1)} className="text-xs text-slate-400 hover:text-slate-900">▲</button>
                  <button aria-label="Move down" onClick={() => moveCat(idx, 1)} className="text-xs text-slate-400 hover:text-slate-900">▼</button>
                </div>
                <span className="flex-1">
                  <span className="font-semibold">{c.name}</span>
                  {c.translations.find((t) => t.locale === "hi") && <span className="ml-2 text-slate-500">{c.translations.find((t) => t.locale === "hi")!.name}</span>}
                  <span className="block text-xs text-slate-500">
                    {c.itemCount} dishes {c.availableFrom && `· ${c.availableFrom}–${c.availableTo}`}
                  </span>
                </span>
                {!c.isActive && <Badge tone="red">hidden</Badge>}
                <Button size="sm" variant="ghost" onClick={() => setEditCat(c)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => confirm(`Archive ${c.name}?`) && run(() => api(`/api/v1/admin/menu/categories/${c.id}`, { method: "DELETE" }))}>
                  Archive
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Dishes">
        <div className="mb-3 flex flex-wrap gap-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search dishes" aria-label="Search dishes" className="h-9 flex-1 rounded-lg border border-slate-300 px-2 text-sm" />
          <select value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }} aria-label="Filter by category" className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="">All categories</option>
            {cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {!items ? (
          <Skeleton className="h-64" />
        ) : items.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No dishes match. <Link href="/admin/menu/items/new" className="underline">Create one</Link>.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr><th className="py-2" /><th>Dish</th><th>Category</th><th className="text-right">Price</th><th>Languages</th><th>Available</th><th /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.rows.map((i, idx) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col">
                          <button aria-label="Move up" onClick={() => moveItem(idx, -1)} className="text-[10px] text-slate-400 hover:text-slate-900">▲</button>
                          <button aria-label="Move down" onClick={() => moveItem(idx, 1)} className="text-[10px] text-slate-400 hover:text-slate-900">▼</button>
                        </div>
                        <FoodImage src={i.imageUrl} alt="" className="h-10 w-10 rounded-lg" />
                      </div>
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5 font-semibold"><DietMark diet={i.dietType} size={12} /> {i.name}</span>
                      <span className="text-xs text-slate-500">
                        {i.groups} customization group(s) {!i.allergenInfoVerified && "· ⚠ allergens unverified"} {i.isBestseller && "· ★"}
                      </span>
                    </td>
                    <td className="text-slate-600">{i.category}</td>
                    <td className="text-right tabular-nums">{formatMoney(i.pricePaise)}</td>
                    <td className="text-xs">{i.locales.join(", ")}</td>
                    <td>
                      <input type="checkbox" checked={i.isAvailable} aria-label={`${i.name} available`} onChange={(e) => run(() => api(`/api/v1/admin/menu/items/${i.id}/availability`, { body: { isAvailable: e.target.checked } }))} className="h-4 w-4 accent-emerald-600" />
                    </td>
                    <td className="text-right">
                      <Link href={`/admin/menu/items/${i.id}`} className="font-semibold underline">Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {items && <Pager page={items.page} pageSize={items.pageSize} total={items.total} onPage={setPage} />}
      </Card>

      {editCat && <CategoryEditor initial={editCat} onClose={() => setEditCat(null)} onSaved={() => { setEditCat(null); void loadCats(); }} />}
    </div>
  );
}

function CategoryEditor({ initial, onClose, onSaved }: { initial: Partial<Category>; onClose: () => void; onSaved: () => void }) {
  const hi = initial.translations?.find((t) => t.locale === "hi");
  const [name, setName] = useState(initial.name ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [hiName, setHiName] = useState(hi?.name ?? "");
  const [hiDesc, setHiDesc] = useState(hi?.description ?? "");
  const [active, setActive] = useState(initial.isActive ?? true);
  const [from, setFrom] = useState(initial.availableFrom ?? "");
  const [to, setTo] = useState(initial.availableTo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name,
        description: description || null,
        isActive: active,
        availableFrom: from || null,
        availableTo: to || null,
        translations: hiName ? [{ locale: "hi", name: hiName, description: hiDesc || null }] : [],
      };
      if (initial.id) await api(`/api/v1/admin/menu/categories/${initial.id}`, { method: "PATCH", body });
      else await api("/api/v1/admin/menu/categories", { body });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title={initial.id ? "Edit category" : "New category"} footer={<div className="flex justify-end"><Button variant="dark" loading={busy} onClick={save} disabled={!name.trim()}>Save</Button></div>}>
      <div className="space-y-3">
        <TextField label="Name (English)" value={name} onChange={setName} maxLength={60} />
        <TextArea label="Description" value={description} onChange={setDescription} />
        <TextField label="Name (हिन्दी)" value={hiName} onChange={setHiName} maxLength={60} lang="hi" />
        <TextArea label="Description (हिन्दी)" value={hiDesc} onChange={setHiDesc} lang="hi" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Available from" type="time" value={from} onChange={setFrom} hint="Optional daily window" />
          <TextField label="Available to" type="time" value={to} onChange={setTo} />
        </div>
        <Check label="Visible on menu" checked={active} onChange={setActive} />
        {error && <ErrorNotice message={error} />}
      </div>
    </Sheet>
  );
}
