// Integer money helpers. All amounts are minor units (paise). Pure — safe on client and server.

/** amount * rateBps / 10000, rounded half-up, using exact integer arithmetic. */
export function applyBps(amount: number, rateBps: number): number {
  if (!Number.isInteger(amount) || !Number.isInteger(rateBps)) throw new Error("applyBps expects integers");
  const sign = amount < 0 ? -1 : 1;
  const num = Math.abs(amount) * rateBps;
  const q = Math.floor(num / 10000);
  const r = num - q * 10000;
  return sign * (r * 2 >= 10000 ? q + 1 : q);
}

/** Integer division rounded half-up. */
export function divRound(numerator: number, denominator: number): number {
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  return r * 2 >= denominator ? q + 1 : q;
}

export function formatMoney(paise: number, currency = "INR", locale = "en-IN"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

/** Split `total` across `weights` proportionally so the parts sum exactly to `total` (largest remainder). */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}
