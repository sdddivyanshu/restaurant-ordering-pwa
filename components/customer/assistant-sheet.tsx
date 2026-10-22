"use client";

import { useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { useI18n } from "@/components/shared/i18n-provider";
import { Badge, Button, DietMark, ErrorNotice, Notice, Sheet, SpiceMeter } from "@/components/shared/ui";
import { formatMoney } from "@/lib/pricing/money";
import type { answerAssistant } from "@/lib/menu/assistant";

type Answer = ReturnType<typeof answerAssistant>;

/**
 * Menu discovery assistant. It only suggests dishes from stored menu metadata; selecting a
 * suggestion opens the dish so the customer decides — it never adds to the cart or orders.
 */
export function AssistantSheet({ onClose, onPick }: { onClose: () => void; onPick: (itemId: string) => void }) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    setQuery(q);
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setAnswer(await api<Answer>("/api/v1/public/menu/assistant", { body: { query: q, lang: locale } }));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={t("assistant.title")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(query);
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("assistant.placeholder")}
          maxLength={300}
          aria-label={t("assistant.title")}
          className="h-12 flex-1 rounded-xl border border-stone-300 bg-white px-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        <Button type="submit" size="lg" loading={loading}>
          {t("assistant.ask")}
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">{t("assistant.examples")}</span>
        {(["assistant.ex1", "assistant.ex2", "assistant.ex3"] as const).map((k) => (
          <button key={k} onClick={() => ask(t(k))} className="rounded-full bg-white px-3 py-1.5 font-medium shadow-soft hover:bg-brand-50">
            {t(k)}
          </button>
        ))}
      </div>

      {error && <div className="mt-4"><ErrorNotice message={error} /></div>}

      {answer && (
        <div className="mt-5 space-y-4" aria-live="polite">
          {answer.focus && (
            <div className="rounded-2xl bg-white p-4 shadow-soft">
              <div className="flex items-center gap-2">
                <DietMark diet={answer.focus.dietType} />
                <h3 className="font-semibold">{answer.focus.title}</h3>
                <SpiceMeter level={answer.focus.spiceLevel} />
              </div>
              <p className="mt-2 text-sm">
                <span className="font-semibold">{t("item.ingredients")}: </span>
                {answer.focus.ingredients.join(", ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1 text-sm">
                <span className="font-semibold">{t("item.allergens")}: </span>
                {answer.focus.allergens.length === 0 ? (
                  <span className="text-muted">{t("item.noAllergens")}</span>
                ) : (
                  answer.focus.allergens.map((a) => (
                    <Badge key={a.key} tone={a.level === "CONTAINS" ? "red" : "amber"}>
                      {a.level === "CONTAINS" ? t("item.contains") : t("item.mayContain")}: {a.name}
                    </Badge>
                  ))
                )}
              </div>
              {!answer.focus.allergenInfoVerified && <div className="mt-2"><Notice>{t("item.unverified")}</Notice></div>}
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => onPick(answer.focus!.itemId)}>
                {answer.focus.title} →
              </Button>
            </div>
          )}
          {answer.summary && <p className="text-sm font-semibold">{answer.summary}</p>}
          <ul className="space-y-2">
            {answer.results.map((r) => (
              <li key={r.itemId}>
                <button onClick={() => onPick(r.itemId)} className="flex w-full items-start gap-3 rounded-2xl bg-white p-3 text-left shadow-soft hover:bg-brand-50">
                  <DietMark diet={r.dietType} />
                  <span className="flex-1">
                    <span className="block font-semibold">{r.name}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {r.reasons.map((x) => (
                        <Badge key={x} tone="green">
                          {x}
                        </Badge>
                      ))}
                    </span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(r.pricePaise)}</span>
                </button>
              </li>
            ))}
          </ul>
          {answer.needsStaffCheck.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold">{t("assistant.staffCheck")}</h4>
              <ul className="space-y-1 text-sm">
                {answer.needsStaffCheck.map((r) => (
                  <li key={r.itemId} className="rounded-xl bg-amber-50 px-3 py-2 text-amber-950">
                    {r.name} — {r.reasons[0]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Notice tone="blue">
            <p>{answer.disclaimer}</p>
            <p className="mt-1 text-xs opacity-80">{t("assistant.source")}</p>
          </Notice>
        </div>
      )}
    </Sheet>
  );
}
