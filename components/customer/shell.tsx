"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/shared/i18n-provider";
import { useCustomerSession } from "@/components/customer/session-provider";
import { useCart } from "@/components/customer/cart-provider";
import { useOnline } from "@/lib/client/use-live";
import { Button, cx, Skeleton } from "@/components/shared/ui";

export function LanguageSwitch({ compact }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="inline-flex rounded-full bg-black/5 p-0.5 text-xs font-semibold" role="group" aria-label={t("common.language")}>
      {(["en", "hi"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={cx("rounded-full px-2.5 py-1 transition", locale === l ? "bg-white text-ink shadow-sm" : "text-muted")}
        >
          {l === "en" ? (compact ? "EN" : "English") : compact ? "हि" : "हिन्दी"}
        </button>
      ))}
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  const { t } = useI18n();
  const [showBack, setShowBack] = useState(false);
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!online) wasOffline.current = true;
    else if (wasOffline.current) {
      wasOffline.current = false;
      setShowBack(true);
      const id = setTimeout(() => setShowBack(false), 3000);
      return () => clearTimeout(id);
    }
  }, [online]);
  if (online && !showBack) return null;
  return (
    <div role="status" className={cx("px-4 py-2 text-center text-sm font-medium", online ? "bg-emerald-700 text-white" : "bg-ink text-white")}>
      {online ? t("common.backOnline") : t("common.offline")}
    </div>
  );
}

const NAV = [
  { href: "/menu", key: "nav.menu", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/orders", key: "nav.orders", icon: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" },
  { href: "/service", key: "nav.service", icon: "M12 4a7 7 0 0 1 7 7v3H5v-3a7 7 0 0 1 7-7zM3 17h18M12 4V2" },
  { href: "/rewards", key: "nav.rewards", icon: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" },
] as const;

export function CustomerShell({ children, hideNav }: { children: React.ReactNode; hideNav?: boolean }) {
  const { session, config, status } = useCustomerSession();
  const { t } = useI18n();
  const pathname = usePathname();
  const cart = useCart();
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-cream">
      <OfflineBanner />
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-stone-200/60 bg-cream/90 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <div className="truncate font-display text-lg font-semibold leading-tight">{config?.name ?? <Skeleton className="h-5 w-40" />}</div>
          {session && (
            <div className="truncate text-xs text-muted">
              {session.table.name} · {session.customer.name}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {config?.isDemo && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">{t("common.demo")}</span>}
          <LanguageSwitch compact />
        </div>
      </header>
      <main className="flex-1 pb-28">{children}</main>
      {!hideNav && status === "ok" && (
        <nav className="no-print fixed inset-x-0 bottom-0 z-30 mx-auto max-w-2xl border-t border-stone-200 bg-white/95 pb-safe backdrop-blur" aria-label="Main">
          <ul className="grid grid-cols-4">
            {NAV.map((n) => {
              const active = pathname?.startsWith(n.href);
              return (
                <li key={n.href}>
                  <Link href={n.href} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold", active ? "text-brand-700" : "text-muted")} aria-current={active ? "page" : undefined}>
                    <span className="relative">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d={n.icon} />
                      </svg>
                      {n.href === "/menu" && cart.count > 0 && (
                        <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] text-white">{cart.count}</span>
                      )}
                    </span>
                    {t(n.key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}

/** Shown when a page needs a customer session but none is active. */
export function ScanPrompt() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <div className="grid h-20 w-20 place-items-center rounded-3xl bg-brand-50 text-4xl" aria-hidden>
        📷
      </div>
      <h1 className="font-display text-2xl font-semibold">{t("session.expiredTitle")}</h1>
      <p className="max-w-sm text-sm text-muted">{t("session.expiredBody")}</p>
      <Link href="/">
        <Button variant="secondary">{t("common.back")}</Button>
      </Link>
    </div>
  );
}

/** Gate a page on an active customer session. */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const { status } = useCustomerSession();
  if (status === "loading")
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  if (status !== "ok") return <ScanPrompt />;
  return <>{children}</>;
}
