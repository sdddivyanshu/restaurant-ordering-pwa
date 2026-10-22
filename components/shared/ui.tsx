"use client";

import { useEffect, useRef } from "react";
import { formatMoney } from "@/lib/pricing/money";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dark" | "success";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  const variants = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
    secondary: "bg-white text-ink border border-stone-300 hover:bg-stone-50",
    ghost: "bg-transparent text-ink hover:bg-black/5",
    danger: "bg-red-700 text-white hover:bg-red-800",
    dark: "bg-ink text-white hover:bg-black",
    success: "bg-emerald-700 text-white hover:bg-emerald-800",
  };
  const sizes = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-[15px]", lg: "h-14 px-6 text-base" };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "h-5 w-5")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Money({ paise, className, currency = "INR" }: { paise: number; className?: string; currency?: string }) {
  return <span className={cx("tabular-nums", className)}>{formatMoney(paise, currency)}</span>;
}

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "brand" | "green" | "red" | "amber" | "blue" | "violet" | "dark"; className?: string }) {
  const tones = {
    neutral: "bg-stone-100 text-stone-700 ring-stone-200",
    brand: "bg-brand-50 text-brand-700 ring-brand-200",
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    red: "bg-red-50 text-red-800 ring-red-200",
    amber: "bg-amber-50 text-amber-900 ring-amber-200",
    blue: "bg-sky-50 text-sky-800 ring-sky-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
    dark: "bg-ink text-white ring-ink",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", tones[tone], className)}>{children}</span>;
}

/** Indian food-labelling style mark: green square/dot = veg, brown triangle = non-veg, amber = egg. */
export function DietMark({ diet, size = 16, label }: { diet: "VEG" | "VEGAN" | "EGG" | "NON_VEG"; size?: number; label?: string }) {
  const color = diet === "NON_VEG" ? "var(--color-nonveg)" : diet === "EGG" ? "var(--color-egg)" : "var(--color-veg)";
  return (
    <span role="img" aria-label={label ?? diet} title={label ?? diet} className="inline-flex shrink-0">
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
        <rect x="1" y="1" width="14" height="14" rx="2" fill="white" stroke={color} strokeWidth="1.6" />
        {diet === "NON_VEG" ? <path d="M8 4 L12 11 L4 11 Z" fill={color} /> : <circle cx="8" cy="8" r="3.4" fill={color} />}
        {diet === "VEGAN" && <path d="M10.5 3.5c-2 0-3 1.2-3 3" stroke="white" strokeWidth="1" fill="none" />}
      </svg>
    </span>
  );
}

export function SpiceMeter({ level, label }: { level: number; label?: string }) {
  if (level <= 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] text-red-700" aria-label={`${label ?? "Spice"} ${level}/3`} title={`${label ?? "Spice"} ${level}/3`}>
      {Array.from({ length: 3 }, (_, i) => (
        <svg key={i} width="10" height="12" viewBox="0 0 10 12" aria-hidden className={i < level ? "opacity-100" : "opacity-20"}>
          <path d="M5 1c.5 1.5 3.5 3 3.5 6.2A3.5 3.5 0 0 1 5 11 3.5 3.5 0 0 1 1.5 7.2C1.5 5 3 4.5 3.5 3 4 4 4.6 4.3 5 1z" fill="currentColor" />
        </svg>
      ))}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-xl", className)} aria-hidden />;
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="text-4xl" aria-hidden>{icon ?? "🍽️"}</div>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorNotice({ message, onRetry, retryLabel = "Try again" }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <span aria-hidden>⚠️</span>
      <div className="flex-1">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="font-semibold underline underline-offset-2">
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function Notice({ children, tone = "amber" }: { children: React.ReactNode; tone?: "amber" | "blue" | "green" | "red" }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    blue: "border-sky-200 bg-sky-50 text-sky-950",
    green: "border-emerald-200 bg-emerald-50 text-emerald-950",
    red: "border-red-200 bg-red-50 text-red-950",
  };
  return <div className={cx("rounded-xl border p-3 text-sm", tones[tone])}>{children}</div>;
}

/** Accessible bottom sheet (mobile) / centered dialog (desktop). Escape and backdrop close it. */
export function Sheet({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.focus(), 10);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-cream shadow-lift outline-none sm:rounded-3xl",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-stone-200/70 px-5 py-3">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-stone-200/70 bg-white/70 px-5 py-3 pb-safe">{footer}</div>}
      </div>
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, max = 20, labels }: { value: number; onChange: (v: number) => void; min?: number; max?: number; labels?: { dec: string; inc: string } }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-stone-300 bg-white">
      <button type="button" className="grid h-10 w-10 place-items-center text-lg font-bold text-brand-700 disabled:opacity-30" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={labels?.dec ?? "Decrease quantity"}>
        −
      </button>
      <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">{value}</span>
      <button type="button" className="grid h-10 w-10 place-items-center text-lg font-bold text-brand-700 disabled:opacity-30" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={labels?.inc ?? "Increase quantity"}>
        +
      </button>
    </div>
  );
}

export function FoodImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  return (
    <img
      src={src || "/images/menu/placeholder.svg"}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cx("bg-sand object-cover", className)}
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.src.endsWith("/images/menu/placeholder.svg")) img.src = "/images/menu/placeholder.svg";
      }}
    />
  );
}
