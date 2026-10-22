"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useI18n } from "@/components/shared/i18n-provider";
import { useCustomerSession } from "@/components/customer/session-provider";
import { Badge, Button, ErrorNotice, Notice, Skeleton } from "@/components/shared/ui";
import { formatDateTime } from "@/components/shared/status";
import { formatMoney } from "@/lib/pricing/money";
import type { MessageKey } from "@/lib/i18n";

interface LoyaltyResponse {
  verified: boolean;
  rules: { enabled: boolean; paisePerPoint: number; minRedeemPoints: number; expiryDays: number };
  rewards: { id: string; name: string; description: string | null; pointsCost: number; affordable?: boolean; minOrderPaise: number }[];
  balance?: number;
  lifetimeEarned?: number;
  entries?: { id: string; type: string; points: number; balanceAfter: number; reason: string | null; at: string }[];
}

export function RewardsView() {
  const { t } = useI18n();
  const { session, refresh: refreshSession } = useCustomerSession();
  const [data, setData] = useState<LoyaltyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<LoyaltyResponse>("/api/v1/customer/rewards").then(setData).catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ mode: string; devCode?: string }>("/api/v1/customer/session/otp", { method: "POST" });
      setCodeSent(true);
      setDevCode(res.devCode ?? null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/customer/session/verify", { body: { code } });
      await refreshSession();
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="p-4">{error ? <ErrorNotice message={error} onRetry={load} /> : <Skeleton className="h-48 w-full" />}</div>;

  return (
    <div className="space-y-5 p-4">
      <h1 className="font-display text-2xl font-semibold">{t("rewards.title")}</h1>
      {error && <ErrorNotice message={error} />}

      {data.verified ? (
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white shadow-lift">
          <p className="text-sm opacity-80">{session?.customer.name}</p>
          <p className="mt-1 font-display text-5xl font-semibold tabular-nums" data-testid="points-balance">
            {data.balance}
          </p>
          <p className="text-sm opacity-90">{t("rewards.points")}</p>
          <Badge tone="dark" className="mt-3 bg-white/15 ring-white/20">
            ✓ {t("rewards.verified")} · {session?.customer.phoneMasked}
          </Badge>
        </section>
      ) : (
        <section className="space-y-3 rounded-3xl bg-white p-5 shadow-soft">
          <h2 className="font-display text-xl font-semibold">{t("rewards.verifyTitle")}</h2>
          <p className="text-sm text-muted">{t("rewards.verifyBody")}</p>
          <p className="text-sm font-semibold">{session?.customer.phoneMasked}</p>
          {session?.otpMode === "disabled" ? (
            <Notice tone="amber">Mobile verification is not enabled at this restaurant.</Notice>
          ) : !codeSent ? (
            <Button onClick={sendCode} loading={busy}>
              {t("rewards.sendCode")}
            </Button>
          ) : (
            <form onSubmit={verify} className="space-y-3">
              {devCode && (
                <Notice tone="amber">
                  <strong>{t("rewards.devCode", { code: devCode })}</strong>
                </Notice>
              )}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t("rewards.code")}
                aria-label={t("rewards.code")}
                className="h-12 w-full rounded-xl border border-stone-300 px-3 text-center text-xl tracking-[0.4em]"
              />
              <div className="flex gap-2">
                <Button type="submit" loading={busy} disabled={code.length !== 6} className="flex-1">
                  {t("rewards.verify")}
                </Button>
                <Button type="button" variant="ghost" onClick={sendCode} disabled={busy}>
                  ↻
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

      <section className="rounded-3xl bg-white p-5 shadow-soft">
        <h2 className="font-semibold">{t("rewards.howItWorks")}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>{t("rewards.earnRule", { amount: formatMoney(data.rules.paisePerPoint) })}</li>
          <li>{t("rewards.minRule", { n: data.rules.minRedeemPoints })}</li>
          {data.rules.expiryDays > 0 && <li>{t("rewards.expiryRule", { n: data.rules.expiryDays })}</li>}
          <li>{t("rewards.redeemHint")}</li>
        </ul>
      </section>

      <section>
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.rewards.map((r) => (
            <li key={r.id} className="rounded-2xl bg-white p-4 shadow-soft">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{r.name}</h3>
                <Badge tone={r.affordable ? "green" : "neutral"}>{t("rewards.cost", { n: r.pointsCost })}</Badge>
              </div>
              {r.description && <p className="mt-1 text-sm text-muted">{r.description}</p>}
            </li>
          ))}
        </ul>
      </section>

      {data.verified && (data.entries?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{t("rewards.activity")}</h2>
          <ul className="divide-y divide-stone-100 rounded-2xl bg-white px-4 shadow-soft">
            {data.entries!.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-3 text-sm">
                <span>
                  <span className="font-semibold">{t(`rewards.e.${e.type}` as MessageKey)}</span>
                  <span className="block text-xs text-muted">
                    {formatDateTime(e.at)} {e.reason ? `· ${e.reason}` : ""}
                  </span>
                </span>
                <span className={`font-semibold tabular-nums ${e.points >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {e.points >= 0 ? "+" : ""}
                  {e.points}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
