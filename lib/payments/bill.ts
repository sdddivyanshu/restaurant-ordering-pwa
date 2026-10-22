// Pure bill arithmetic. Payment state is derived from recorded payments and adjustments,
// independent of the operational order status.

export type PaymentStatusValue = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "REFUNDED" | "VOIDED";

export interface BillInput {
  totalPaise: number;
  orderCancelled: boolean;
  payments: { amountPaise: number; status: "RECORDED" | "VOIDED" }[];
  adjustments: { type: "DISCOUNT" | "CORRECTION" | "REFUND" | "PAYMENT_VOID"; amountPaise: number }[];
}

export interface BillSummary {
  totalPaise: number;
  adjustmentDiscountPaise: number;
  payablePaise: number;
  paidPaise: number;
  refundedPaise: number;
  netPaidPaise: number;
  duePaise: number;
  status: PaymentStatusValue;
}

export function summarizeBill(input: BillInput): BillSummary {
  const adjustmentDiscountPaise = input.adjustments
    .filter((a) => a.type === "DISCOUNT" || a.type === "CORRECTION")
    .reduce((s, a) => s + a.amountPaise, 0);
  const refundedPaise = input.adjustments.filter((a) => a.type === "REFUND").reduce((s, a) => s + a.amountPaise, 0);
  const paidPaise = input.payments.filter((p) => p.status === "RECORDED").reduce((s, p) => s + p.amountPaise, 0);
  const payablePaise = input.orderCancelled ? 0 : Math.max(0, input.totalPaise - adjustmentDiscountPaise);
  const netPaidPaise = paidPaise - refundedPaise;
  const duePaise = Math.max(0, payablePaise - netPaidPaise);

  let status: PaymentStatusValue;
  if (refundedPaise > 0 && netPaidPaise <= 0) status = "REFUNDED";
  else if (input.orderCancelled && paidPaise === 0) status = "VOIDED";
  else if (payablePaise > 0 && duePaise === 0) status = "PAID";
  else if (payablePaise === 0 && !input.orderCancelled) status = "PAID";
  else if (netPaidPaise > 0) status = "PARTIALLY_PAID";
  else status = "UNPAID";

  return { totalPaise: input.totalPaise, adjustmentDiscountPaise, payablePaise, paidPaise, refundedPaise, netPaidPaise, duePaise, status };
}
