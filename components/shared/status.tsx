"use client";

import { Badge } from "@/components/shared/ui";

const ORDER_TONES: Record<string, Parameters<typeof Badge>[0]["tone"]> = {
  PENDING_APPROVAL: "amber",
  CHANGE_REQUESTED: "violet",
  CUSTOMER_CONFIRMATION_REQUIRED: "violet",
  APPROVED: "blue",
  QUEUED: "blue",
  PREPARING: "brand",
  READY: "green",
  SERVED: "neutral",
  REJECTED: "red",
  CANCELLED: "red",
  CANCEL_REQUESTED: "red",
};

const PAY_TONES: Record<string, Parameters<typeof Badge>[0]["tone"]> = {
  UNPAID: "amber",
  PARTIALLY_PAID: "amber",
  PAID: "green",
  REFUNDED: "violet",
  VOIDED: "neutral",
};

export const humanize = (s: string) => s.toLowerCase().replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

export function OrderStatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={ORDER_TONES[status] ?? "neutral"}>{label ?? humanize(status)}</Badge>;
}

export function PaymentStatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={PAY_TONES[status] ?? "neutral"}>{label ?? humanize(status)}</Badge>;
}

export function LiveDot({ state }: { state: "connecting" | "live" | "polling" | "offline" }) {
  const map = {
    live: ["bg-emerald-500", "Live"],
    polling: ["bg-amber-500", "Reconnecting (polling)"],
    connecting: ["bg-stone-400", "Connecting"],
    offline: ["bg-red-500", "Offline"],
  } as const;
  const [color, text] = map[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      {text}
    </span>
  );
}

export function timeAgo(date: string | Date, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatTime(date: string | Date | null | undefined, locale = "en-IN") {
  if (!date) return "—";
  return new Date(date).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(date: string | Date | null | undefined, locale = "en-IN") {
  if (!date) return "—";
  return new Date(date).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
