"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Button, ErrorNotice, FoodImage, Notice, Skeleton } from "@/components/shared/ui";
import { Card, Check, PageHeader, SelectField, TextArea, TextField, rupees, toPaise } from "@/components/admin/kit";

interface Reference {
  taxes: { id: string; code: string; name: string; rateBps: number; isDefault: boolean }[];
  allergens: { key: string; name: string }[];
  attributes: { key: string; name: string }[];
  categories: { id: string; name: string }[];
  groups: { id: string; name: string; kind: string; options: { name: string }[] }[];
}

interface ItemData {
  id?: string;
  name: string;
  description: string | null;
  categoryId: string;
  imageUrl: string | null;
  basePricePaise: number;
  taxConfigId: string;
  dietType: "VEG" | "VEGAN" | "EGG" | "NON_VEG";
  spiceLevel: number;
  ingredients: string[];
  prepMinutes: number;
  calories: number | null;
  isAvailable: boolean;
  isBestseller: boolean;
  isRecommended: boolean;
  allergenInfoVerified: boolean;
  availableFrom: string | null;
  availableTo: string | null;
  seasonalFrom: string | null;
  seasonalTo: string | null;
  allergens: { key: string; level: "CONTAINS" | "MAY_CONTAIN" }[];
  dietaryAttributes: string[];
  customizationGroupIds: string[];
  translations: { locale: string; name: string; description: string | null; ingredients: string[] }[];
}

export function ItemEditor({ id }: { id: string | null }) {
  const router = useRouter();
  const [ref, setRef] = useState<Reference | null>(null);
  const [item, setItem] = useState<ItemData | null>(null);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Reference>("/api/v1/admin/menu/reference").then((r) => {
      setRef(r);
      if (!id) {
        setItem({
          name: "",
          description: "",
          categoryId: r.categories[0]?.id ?? "",
          imageUrl: null,
          basePricePaise: 0,
          taxConfigId: r.taxes.find((t) => t.isDefault)?.id ?? r.taxes[0]?.id ?? "",
          dietType: "VEG",
          spiceLevel: 0,
          ingredients: [],
          prepMinutes: 15,
          calories: null,
          isAvailable: true,
          isBestseller: false,
          isRecommended: false,
          allergenInfoVerified: false,
          availableFrom: null,
          availableTo: null,
          seasonalFrom: null,
          seasonalTo: null,
          allergens: [],
          dietaryAttributes: [],
          customizationGroupIds: [],
          translations: [],
        });
      }
    });
    if (id)
      api<{ item: ItemData }>(`/api/v1/admin/menu/items/${id}`).then((r) => {
        setItem(r.item);
        setPrice(rupees(r.item.basePricePaise));
      });
  }, [id]);

  if (!ref || !item) return <Skeleton className="h-96" />;
  const set = <K extends keyof ItemData>(k: K, v: ItemData[K]) => setItem((s) => (s ? { ...s, [k]: v } : s));
  const hi = item.translations.find((t) => t.locale === "hi") ?? { locale: "hi", name: "", description: "", ingredients: [] };
  const setHi = (patch: Partial<typeof hi>) => set("translations", [...item.translations.filter((t) => t.locale !== "hi"), { ...hi, ...patch }]);

  async function upload(file: File) {
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/v1/admin/menu/upload", { method: "POST", body: fd });
    const json = await res.json();
    if (!res.ok) setError(json.error?.message ?? "Upload failed");
    else set("imageUrl", json.url);
  }

  async function save() {
    if (!item) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body = {
        ...item,
        description: item.description || null,
        basePricePaise: toPaise(price),
        seasonalFrom: item.seasonalFrom || null,
        seasonalTo: item.seasonalTo || null,
        availableFrom: item.availableFrom || null,
        availableTo: item.availableTo || null,
        translations: item.translations.filter((t) => t.name.trim()),
      };
      delete (body as { id?: string }).id;
      for (const k of ["slug", "displayOrder", "archivedAt", "createdAt", "updatedAt", "updatedById"]) delete (body as Record<string, unknown>)[k];
      if (id) {
        await api(`/api/v1/admin/menu/items/${id}`, { method: "PATCH", body });
        setSaved(true);
      } else {
        const res = await api<{ item: { id: string } }>("/api/v1/admin/menu/items", { body });
        router.replace(`/admin/menu/items/${res.item.id}`);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? `${err.message}${Array.isArray(err.details) ? ": " + (err.details as { path: string; message: string }[]).map((d) => `${d.path} ${d.message}`).join("; ") : ""}` : String(err));
    } finally {
      setBusy(false);
    }
  }

  const allergenLevel = (key: string) => item.allergens.find((a) => a.key === key)?.level ?? "";

  return (
    <div className="space-y-5">
      <PageHeader
        title={id ? `Edit: ${item.name}` : "New dish"}
        actions={
          <>
            {id && (
              <Button variant="secondary" onClick={async () => { if (confirm("Archive this dish? It will disappear from the menu; past orders are unaffected.")) { await api(`/api/v1/admin/menu/items/${id}`, { method: "DELETE" }); router.push("/admin/menu"); } }}>
                Archive
              </Button>
            )}
            <Button variant="dark" loading={busy} onClick={save}>Save</Button>
          </>
        }
      />
      {error && <ErrorNotice message={error} />}
      {saved && <Notice tone="green">Saved. Price changes apply to new orders only — existing orders keep their snapshot.</Notice>}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Basics">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Name (English)" value={item.name} onChange={(v) => set("name", v)} maxLength={80} />
            <SelectField label="Category" value={item.categoryId} onChange={(v) => set("categoryId", v)} options={ref.categories.map((c) => ({ value: c.id, label: c.name }))} />
            <div className="sm:col-span-2"><TextArea label="Description" value={item.description ?? ""} onChange={(v) => set("description", v)} maxLength={500} /></div>
            <TextField label="Base price (₹)" type="number" step="0.01" min="0" value={price} onChange={setPrice} />
            <SelectField label="Tax" value={item.taxConfigId} onChange={(v) => set("taxConfigId", v)} options={ref.taxes.map((t) => ({ value: t.id, label: `${t.name}` }))} />
            <SelectField label="Diet" value={item.dietType} onChange={(v) => set("dietType", v as ItemData["dietType"])} options={[{ value: "VEG", label: "Vegetarian" }, { value: "VEGAN", label: "Vegan" }, { value: "EGG", label: "Contains egg" }, { value: "NON_VEG", label: "Non-vegetarian" }]} />
            <SelectField label="Spice level" value={String(item.spiceLevel)} onChange={(v) => set("spiceLevel", Number(v))} options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: ["Not spicy", "Mild", "Medium", "Hot"][n] }))} />
            <TextField label="Prep time (min)" type="number" min="1" value={item.prepMinutes} onChange={(v) => set("prepMinutes", Number(v) || 1)} />
            <TextField label="Calories (optional)" type="number" min="0" value={item.calories ?? ""} onChange={(v) => set("calories", v ? Number(v) : null)} />
            <div className="sm:col-span-2"><TextField label="Ingredients (comma separated)" value={item.ingredients.join(", ")} onChange={(v) => set("ingredients", v.split(",").map((s) => s.trim()).filter(Boolean))} /></div>
          </div>
        </Card>
        <Card title="Photo & availability">
          <div className="flex gap-4">
            <FoodImage src={item.imageUrl} alt="" className="h-32 w-32 rounded-xl" />
            <div className="space-y-2 text-sm">
              <label className="block font-semibold">
                Upload photo (PNG/JPEG/WebP, max 2 MB)
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="mt-1 block text-sm" />
              </label>
              {item.imageUrl && <button className="text-xs underline" onClick={() => set("imageUrl", null)}>Remove photo</button>}
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            <Check label="Available" checked={item.isAvailable} onChange={(v) => set("isAvailable", v)} />
            <Check label="Bestseller" checked={item.isBestseller} onChange={(v) => set("isBestseller", v)} />
            <Check label="Recommended" checked={item.isRecommended} onChange={(v) => set("isRecommended", v)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <TextField label="Daily from" type="time" value={item.availableFrom ?? ""} onChange={(v) => set("availableFrom", v || null)} />
            <TextField label="Daily to" type="time" value={item.availableTo ?? ""} onChange={(v) => set("availableTo", v || null)} />
            <TextField label="Season starts" type="date" value={item.seasonalFrom?.slice(0, 10) ?? ""} onChange={(v) => set("seasonalFrom", v || null)} />
            <TextField label="Season ends" type="date" value={item.seasonalTo?.slice(0, 10) ?? ""} onChange={(v) => set("seasonalTo", v || null)} />
          </div>
        </Card>
        <Card title="Allergens & dietary information">
          <ul className="grid gap-2 sm:grid-cols-2">
            {ref.allergens.map((a) => (
              <li key={a.key} className="flex items-center justify-between gap-2 text-sm">
                <span>{a.name}</span>
                <select
                  value={allergenLevel(a.key)}
                  aria-label={`${a.name} level`}
                  onChange={(e) => set("allergens", [...item.allergens.filter((x) => x.key !== a.key), ...(e.target.value ? [{ key: a.key, level: e.target.value as "CONTAINS" | "MAY_CONTAIN" }] : [])])}
                  className="h-8 rounded-lg border border-slate-300 px-1 text-xs"
                >
                  <option value="">—</option>
                  <option value="CONTAINS">Contains</option>
                  <option value="MAY_CONTAIN">May contain</option>
                </select>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-3">
            {ref.attributes.map((d) => (
              <Check key={d.key} label={d.name} checked={item.dietaryAttributes.includes(d.key)} onChange={(v) => set("dietaryAttributes", v ? [...item.dietaryAttributes, d.key] : item.dietaryAttributes.filter((x) => x !== d.key))} />
            ))}
          </div>
          <div className="mt-3 rounded-xl bg-amber-50 p-3">
            <Check label="Allergen information verified against the recipe" hint="Unverified dishes are never suggested as safe by the dietary assistant." checked={item.allergenInfoVerified} onChange={(v) => set("allergenInfoVerified", v)} />
          </div>
        </Card>
        <Card title="Customizations">
          <ul className="grid gap-2">
            {ref.groups.map((g) => (
              <li key={g.id}>
                <Check
                  label={`${g.name} (${g.kind.toLowerCase()})`}
                  hint={g.options.map((o) => o.name).join(", ")}
                  checked={item.customizationGroupIds.includes(g.id)}
                  onChange={(v) => set("customizationGroupIds", v ? [...item.customizationGroupIds, g.id] : item.customizationGroupIds.filter((x) => x !== g.id))}
                />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="हिन्दी translation" className="xl:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2" lang="hi">
            <TextField label="Name (हिन्दी)" value={hi.name} onChange={(v) => setHi({ name: v })} />
            <TextField label="Ingredients (हिन्दी, comma separated)" value={hi.ingredients.join(", ")} onChange={(v) => setHi({ ingredients: v.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <div className="sm:col-span-2"><TextArea label="Description (हिन्दी)" value={hi.description ?? ""} onChange={(v) => setHi({ description: v })} /></div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Missing translations fall back to English automatically.</p>
        </Card>
      </div>
    </div>
  );
}
