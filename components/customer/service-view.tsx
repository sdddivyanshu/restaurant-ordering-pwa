"use client";

import { useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useLiveData } from "@/lib/client/use-live";
import { useI18n } from "@/components/shared/i18n-provider";
import { Badge, Button, ErrorNotice, Notice, cx } from "@/components/shared/ui";
import { timeAgo } from "@/components/shared/status";
import type { MessageKey } from "@/lib/i18n";

const TYPES = [
  ["WAITER", "🙋"],
  ["WATER", "💧"],
  ["CUTLERY", "🍴"],
  ["BILL", "🧾"],
  ["TAKEAWAY_PACKAGING", "🥡"],
  ["ASSISTANCE", "🆘"],
] as const;

interface RequestsResponse {
  requests: { id: string; type: string; message: string | null; status: string; createdAt: string; canCancel: boolean }[];
}

export function ServiceView() {
  const { t } = useI18n();
  const { data, refresh } = useLiveData<RequestsResponse>("/api/v1/customer/service-requests", { sseUrl: "/api/v1/customer/events" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "green" | "blue"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  async function send(type: string, message?: string) {
    setBusy(type);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ duplicate: boolean }>("/api/v1/customer/service-requests", { body: { type, message } });
      setNotice(res.duplicate ? { tone: "blue", text: t("service.already") } : { tone: "green", text: `✓ ${t("service.sent")}` });
      if (type === "CUSTOM") {
        setCustom("");
        setShowCustom(false);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? (err.isNetwork ? t("common.offline") : err.message) : String(err));
    } finally {
      setBusy(null);
    }
  }

  const open = (data?.requests ?? []).filter((r) => ["PENDING", "ACKNOWLEDGED", "IN_PROGRESS"].includes(r.status));

  return (
    <div className="space-y-5 p-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">{t("service.title")}</h1>
        <p className="text-sm text-muted">{t("service.subtitle")}</p>
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {error && <ErrorNotice message={error} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {TYPES.map(([type, icon]) => {
          const pending = open.some((r) => r.type === type);
          return (
            <button
              key={type}
              onClick={() => send(type)}
              disabled={busy !== null}
              className={cx("flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl bg-white p-3 text-center shadow-soft transition active:scale-[0.98]", pending && "ring-2 ring-brand-300")}
            >
              <span className="text-3xl" aria-hidden>{icon}</span>
              <span className="text-sm font-semibold">{t(`service.${type}` as MessageKey)}</span>
              {pending && <span className="text-[11px] text-brand-700">{t("service.st.PENDING")}…</span>}
            </button>
          );
        })}
        <button onClick={() => setShowCustom((v) => !v)} className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl bg-white p-3 shadow-soft">
          <span className="text-3xl" aria-hidden>💬</span>
          <span className="text-sm font-semibold">{t("service.CUSTOM")}</span>
        </button>
      </div>
      {showCustom && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim().length >= 2) void send("CUSTOM", custom.trim());
          }}
          className="space-y-2 rounded-2xl bg-white p-3 shadow-soft"
        >
          <textarea value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={140} rows={2} placeholder={t("service.customPlaceholder")} aria-label={t("service.customPlaceholder")} className="w-full rounded-xl border border-stone-200 p-2 text-sm" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{custom.length}/140</span>
            <Button type="submit" size="sm" loading={busy === "CUSTOM"} disabled={custom.trim().length < 2}>
              {t("service.send")}
            </Button>
          </div>
        </form>
      )}

      {(data?.requests.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">{t("service.recent")}</h2>
          <ul className="space-y-2">
            {data!.requests.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-xl bg-white p-3 text-sm shadow-soft">
                <span className="flex-1">
                  <span className="font-semibold">{t(`service.${r.type}` as MessageKey)}</span>
                  {r.message && <span className="block text-xs text-muted">“{r.message}”</span>}
                  <span className="block text-xs text-muted">{timeAgo(r.createdAt)}</span>
                </span>
                <Badge tone={r.status === "COMPLETED" ? "green" : r.status === "CANCELLED" ? "neutral" : "amber"}>{t(`service.st.${r.status}` as MessageKey)}</Badge>
                {r.canCancel && (
                  <button
                    className="text-xs font-semibold text-muted underline"
                    onClick={async () => {
                      await api(`/api/v1/customer/service-requests/${r.id}/cancel`, { method: "POST" }).catch(() => {});
                      await refresh();
                    }}
                  >
                    {t("common.cancel")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
