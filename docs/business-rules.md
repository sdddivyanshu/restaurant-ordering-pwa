# Business rules: pricing, billing, loyalty, analytics

## Pricing & tax (`lib/pricing/calculator.ts`)

- Unit price = base price + sum of selected option deltas. Line subtotal = unit × quantity.
- Reward discounts are computed on the pre-tax subtotal, capped at the subtotal, and allocated across lines
  proportionally (largest remainder) so tax applies to discounted amounts.
- Tax per line, per item tax category, rounded half-up to the paisa. Display split into components
  (e.g. CGST 2.5% + SGST 2.5%).
- `pricesIncludeTax = true` → tax is extracted from the price; otherwise added on top.
- `roundingMode = NEAREST_RUPEE` → the bill total is rounded half-up to ₹1; the difference is shown as
  "Rounding".
- Rates are configuration (Admin → Settings & tax); no universal rate is hard-coded.

## Billing (`lib/payments`)

- `payable = total − (discount + correction adjustments)`; `netPaid = recorded payments − refunds`;
  `due = max(0, payable − netPaid)`.
- Payment status: UNPAID → PARTIALLY_PAID → PAID; REFUNDED when everything collected was refunded; VOIDED
  when a rejected/cancelled order had no payments.
- Payments can only be recorded for approved orders, never above the amount due; each recording carries an
  idempotency key. Post-bill discounts reduce the amount due but do not recompute GST (apply discounts before
  approval via rewards when tax-accurate discounting matters).
- All payments are **manual records** (`providerVerified = false`). Receipts are immutable snapshots.

## Loyalty (`lib/loyalty`) — demo rules

| Rule | Default |
|---|---|
| Earn | 1 point per ₹10 of net sales (subtotal − discounts, excluding tax) |
| When | once the order is both **SERVED** and **PAID** (whichever happens last triggers it) |
| Duplicate protection | ledger `dedupeKey` `earn:{orderId}:{cycle}`; order row lock |
| Reversal | a refund or a void that leaves the bill unpaid removes the points earned on that order (never below 0) |
| Redeem | phone-verified session; reward active and in validity window; cost ≥ min redeem points (50); balance ≥ cost; order ≥ reward minimum; free-item rewards need that item in the cart |
| Cancelled/rejected order | redeemed points are returned (`REDEEM_REVERSAL`) |
| Expiry | balance expires after 365 days without earning (`EXPIRE` entry) |

Seeded rewards: Free Masala Chai (60), Free Gulab Jamun (80), ₹100 off orders ≥ ₹500 (100),
10% off up to ₹150 (150). Demo customer +91 98000 00001 starts with 200 points (verify via the dev OTP).

## Analytics definitions (`lib/analytics/service.ts`)

| Metric | Definition |
|---|---|
| Orders | submitted in range (submission time, restaurant timezone) |
| Accepted orders | APPROVED, QUEUED, PREPARING, READY, SERVED, CANCEL_REQUESTED |
| Gross sales | Σ subtotal of accepted orders (before discounts, excl. tax) |
| Discounts | reward discounts + cashier DISCOUNT/CORRECTION adjustments on accepted orders |
| Refunds | REFUND adjustments on accepted orders |
| Net sales | gross − discounts − refunds, excl. tax; **includes unpaid** accepted orders (accrual) — see Paid vs unpaid |
| Tax | tax on accepted orders as calculated at ordering |
| AOV | net sales ÷ accepted orders |
| Rejected / cancelled rate | rejected (cancelled) ÷ submitted |
| Approval time | avg(approvedAt − submittedAt) |
| Kitchen prep time | avg(readyAt − preparingAt) |
| Ready-to-serve | avg(servedAt − readyAt) |
| Service resolution | avg(completedAt − createdAt) for completed requests |
| Demo data | seeded rows have `isDemo = true`; the "Include demo data" toggle excludes them |
