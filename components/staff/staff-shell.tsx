"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { cx } from "@/components/shared/ui";
import type { StaffPageUser } from "@/lib/auth/page-guard";

const LINKS = [
  { href: "/staff/supervisor", label: "Approvals", perms: ["order.approve", "order.view"] },
  { href: "/staff/kitchen", label: "Kitchen", perms: ["kitchen.view"] },
  { href: "/staff/service", label: "Service", perms: ["service.view"] },
  { href: "/staff/cashier", label: "Cashier", perms: ["bill.view"] },
  { href: "/admin", label: "Admin", perms: ["settings.manage", "analytics.view", "menu.manage"] },
];

export function StaffShell({ user, children, dark, wide = true }: { user: StaffPageUser; children: React.ReactNode; dark?: boolean; wide?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const links = LINKS.filter((l) => l.perms.some((p) => user.permissions.includes(p)));
  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/staff/login");
  }
  return (
    <div className={cx("min-h-dvh", dark ? "bg-zinc-950 text-zinc-100" : "bg-slate-100 text-slate-900")}>
      <header className={cx("no-print sticky top-0 z-30 border-b", dark ? "border-zinc-800 bg-zinc-900" : "border-slate-200 bg-white")}>
        <div className={cx("mx-auto flex h-14 items-center gap-4 px-4", wide ? "max-w-[1600px]" : "max-w-5xl")}>
          <Link href="/staff" className="flex items-center gap-2 font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white" aria-hidden>
              🍽
            </span>
            <span className="hidden sm:inline">Restaurant Ops</span>
          </Link>
          <nav className="no-scrollbar flex flex-1 gap-1 overflow-x-auto" aria-label="Staff">
            {links.map((l) => {
              const active = pathname === l.href || pathname?.startsWith(l.href + "/");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold",
                    active ? (dark ? "bg-zinc-700 text-white" : "bg-slate-900 text-white") : dark ? "text-zinc-300 hover:bg-zinc-800" : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-right leading-tight md:block">
              <span className="block font-semibold">{user.name}</span>
              <span className={cx("block text-xs", dark ? "text-zinc-400" : "text-slate-500")}>{user.roleName}</span>
            </span>
            <button onClick={logout} className={cx("rounded-lg px-3 py-1.5 font-semibold", dark ? "bg-zinc-800 hover:bg-zinc-700" : "bg-slate-100 hover:bg-slate-200")}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className={cx("mx-auto px-4 py-5", wide ? "max-w-[1600px]" : "max-w-5xl")}>{children}</main>
    </div>
  );
}

export function NoAccess() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl bg-white p-8 text-center shadow">
      <h1 className="text-xl font-bold">No access</h1>
      <p className="mt-2 text-sm text-slate-600">Your role does not include this area. Ask an administrator if you need access.</p>
    </div>
  );
}
