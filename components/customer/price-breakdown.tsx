"use client";

import { useI18n } from "@/components/shared/i18n-provider";
import { formatMoney } from "@/lib/pricing/money";

export interface Totals {
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  roundingPaise: number;
  totalPaise: number;
  pricesIncludeTax: boolean;
  taxBreakdown: unknown;
}

interface TaxEntry {
  code: string;
  name: string;
  rateBps: number;
  taxPaise: number;
  components: { name: string; rateBps: number; amountPaise: number }[];
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

export function PriceBreakdown({ totals, discountLabel, extra }: { totals: Totals; discountLabel?: string | null; extra?: React.ReactNode }) {
  const { t } = useI18n();
  const taxes = (Array.isArray(totals.taxBreakdown) ? totals.taxBreakdown : []) as TaxEntry[];
  return (
    <dl className="space-y-1.5 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted">{t("cart.subtotal")}</dt>
        <dd className="tabular-nums">{formatMoney(totals.subtotalPaise)}</dd>
      </div>
      {totals.discountPaise > 0 && (
        <div className="flex justify-between text-emerald-700">
          <dt>
            {t("cart.discount")}
            {discountLabel ? ` · ${discountLabel}` : ""}
          </dt>
          <dd className="tabular-nums">−{formatMoney(totals.discountPaise)}</dd>
        </div>
      )}
      {taxes.flatMap((tx) =>
        (tx.components.length ? tx.components : [{ name: tx.name, rateBps: tx.rateBps, amountPaise: tx.taxPaise }]).map((c) => (
          <div key={`${tx.code}-${c.name}`} className="flex justify-between">
            <dt className="text-muted">
              {c.name} {pct(c.rateBps)}
              {totals.pricesIncludeTax ? " (incl.)" : ""}
            </dt>
            <dd className="tabular-nums">{formatMoney(c.amountPaise)}</dd>
          </div>
        )),
      )}
      {totals.roundingPaise !== 0 && (
        <div className="flex justify-between">
          <dt className="text-muted">{t("cart.rounding")}</dt>
          <dd className="tabular-nums">
            {totals.roundingPaise > 0 ? "+" : "−"}
            {formatMoney(Math.abs(totals.roundingPaise))}
          </dd>
        </div>
      )}
      {extra}
      <div className="flex justify-between border-t border-dashed border-stone-300 pt-2 text-base font-bold">
        <dt>{t("cart.payable")}</dt>
        <dd className="tabular-nums" data-testid="order-total">
          {formatMoney(totals.totalPaise)}
        </dd>
      </div>
      {totals.pricesIncludeTax && <p className="text-xs text-muted">{t("cart.inclTax")}</p>}
    </dl>
  );
}
