"use client";

import { useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useI18n } from "@/components/shared/i18n-provider";
import { Button, ErrorNotice } from "@/components/shared/ui";

function Stars({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} / 5`}
            onClick={() => onChange(n)}
            className={`grid h-10 w-10 place-items-center rounded-lg text-2xl ${n <= value ? "text-amber-500" : "text-stone-300"}`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

export function FeedbackForm({ orderId, items, onDone }: { orderId: string; items: { id: string; name: string }[]; onDone: () => void }) {
  const { t } = useI18n();
  const [overall, setOverall] = useState(0);
  const [food, setFood] = useState(0);
  const [service, setService] = useState(0);
  const [comment, setComment] = useState("");
  const [itemRatings, setItemRatings] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!overall || !food || !service) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/customer/feedback", {
        body: { orderId, overall, food, service, comment: comment.trim() || undefined, itemRatings: Object.entries(itemRatings).map(([orderItemId, rating]) => ({ orderItemId, rating })) },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-3xl bg-white p-4 shadow-soft">
      <h2 className="font-display text-xl font-semibold">{t("feedback.title")}</h2>
      <Stars value={overall} onChange={setOverall} label={t("feedback.overall")} />
      <Stars value={food} onChange={setFood} label={t("feedback.food")} />
      <Stars value={service} onChange={setService} label={t("feedback.service")} />
      {items.length > 1 && (
        <details className="rounded-xl bg-sand p-2 text-sm">
          <summary className="cursor-pointer font-semibold">{t("order.items")}</summary>
          <div className="mt-2 space-y-1">
            {items.map((i) => (
              <Stars key={i.id} value={itemRatings[i.id] ?? 0} onChange={(v) => setItemRatings((s) => ({ ...s, [i.id]: v }))} label={i.name} />
            ))}
          </div>
        </details>
      )}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder={t("feedback.comment")}
        aria-label={t("feedback.comment")}
        className="w-full rounded-xl border border-stone-200 p-2 text-sm outline-none focus:border-brand-400"
      />
      {error && <ErrorNotice message={error} />}
      <Button type="submit" className="w-full" loading={busy} disabled={!overall || !food || !service}>
        {t("feedback.submit")}
      </Button>
    </form>
  );
}
