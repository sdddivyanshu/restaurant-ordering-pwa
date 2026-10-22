"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/shared/ui";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className }: { title?: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-bold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const inputCls = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-normal outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

export function TextField({ label, value, onChange, type = "text", hint, ...rest }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; hint?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} {...rest} />
      {hint && <span className="mt-0.5 block text-xs font-normal text-slate-500">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, value, onChange, rows = 2, ...rest }: { label: string; value: string; onChange: (v: string) => void; rows?: number } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value">) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm font-normal" {...rest} />
    </label>
  );
}

export function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-slate-900" />
      <span>
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span>
        {total} result{total === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-lg bg-white px-3 py-1 ring-1 ring-slate-200 disabled:opacity-40">
          ← Prev
        </button>
        <span>
          {page} / {pages}
        </span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-lg bg-white px-3 py-1 ring-1 ring-slate-200 disabled:opacity-40">
          Next →
        </button>
      </div>
    </div>
  );
}

const NAV = [
  { href: "/admin", label: "Overview", perm: "analytics.view" },
  { href: "/admin/analytics", label: "Analytics", perm: "analytics.view" },
  { href: "/admin/orders", label: "Orders", perm: "order.view" },
  { href: "/admin/menu", label: "Menu", perm: "menu.manage" },
  { href: "/admin/menu/groups", label: "Customizations", perm: "menu.manage" },
  { href: "/admin/tables", label: "Tables & QR", perm: "table.manage" },
  { href: "/admin/rewards", label: "Rewards", perm: "settings.manage" },
  { href: "/admin/feedback", label: "Feedback", perm: "feedback.view" },
  { href: "/admin/users", label: "Staff & roles", perm: "user.manage" },
  { href: "/admin/settings", label: "Settings & tax", perm: "settings.manage" },
  { href: "/admin/dispatch", label: "Kitchen dispatch", perm: "outbox.manage" },
  { href: "/admin/audit", label: "Audit log", perm: "audit.view" },
];

export function AdminNav({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const items = NAV.filter((n) => permissions.includes(n.perm));
  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col" aria-label="Admin">
      {items.map((n) => {
        const active = n.href === "/admin" ? pathname === "/admin" : pathname === n.href || (pathname?.startsWith(n.href + "/") && !(n.href === "/admin/menu" && pathname.startsWith("/admin/menu/groups")));
        return (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cx("shrink-0 rounded-lg px-3 py-2 text-sm font-semibold", active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-white")}>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: "red" | "amber" | "green"; hint?: string }) {
  return (
    <div className={cx("rounded-2xl bg-white p-4 shadow-sm ring-1", tone === "red" ? "ring-red-300" : tone === "amber" ? "ring-amber-300" : tone === "green" ? "ring-emerald-300" : "ring-slate-200")}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export const rupees = (paise: number | null | undefined) => (paise == null ? "" : (paise / 100).toFixed(2).replace(/\.00$/, ""));
export const toPaise = (v: string) => Math.round(parseFloat(v || "0") * 100);
