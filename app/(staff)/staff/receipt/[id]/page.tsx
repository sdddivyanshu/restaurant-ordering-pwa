import { requireStaffPage } from "@/lib/auth/page-guard";
import { NoAccess } from "@/components/staff/staff-shell";
import { prisma } from "@/lib/db/prisma";
import { ensureReceipt } from "@/lib/payments/service";
import { formatMoney } from "@/lib/pricing/money";
import { PrintButton } from "@/components/cashier/print-button";

export const metadata = { title: "Receipt" };

interface Snapshot {
  restaurant: { name: string; legalName: string | null; address: string | null; gstin: string | null; phone: string | null };
  order: { reference: string; table: string; customerName: string; submittedAt: string };
  items: { name: string; quantity: number; options: string[]; unitPricePaise: number; lineSubtotalPaise: number }[];
  totals: { subtotalPaise: number; discountPaise: number; taxPaise: number; roundingPaise: number; totalPaise: number; pricesIncludeTax: boolean; taxBreakdown: { code: string; name: string; components: { name: string; rateBps: number; amountPaise: number }[]; taxPaise: number }[] };
  bill: { adjustmentDiscountPaise: number; netPaidPaise: number; duePaise: number; refundedPaise: number };
  payments: { method: string; amountPaise: number; at: string; verified: boolean }[];
  footer: string | null;
}

/** Print-friendly receipt from the immutable snapshot (menu changes never alter it). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, allowed } = await requireStaffPage(["bill.view"]);
  if (!allowed) return <NoAccess />;
  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id }, select: { id: true, paymentStatus: true } });
  if (!order || (order.paymentStatus !== "PAID" && order.paymentStatus !== "REFUNDED")) {
    return <p className="p-8 text-center">A receipt is available once the bill is fully paid.</p>;
  }
  const receipt = await prisma.$transaction((tx) => ensureReceipt(tx, id));
  const s = receipt.snapshot as unknown as Snapshot;
  return (
    <main className="mx-auto max-w-sm bg-white p-6 font-mono text-[13px] text-black">
      <div className="text-center">
        <p className="text-base font-bold">{s.restaurant.name}</p>
        {s.restaurant.legalName && <p>{s.restaurant.legalName}</p>}
        {s.restaurant.address && <p>{s.restaurant.address}</p>}
        {s.restaurant.gstin && <p>GSTIN: {s.restaurant.gstin}</p>}
      </div>
      <hr className="my-2 border-dashed border-black" />
      <p>Receipt: {receipt.number}</p>
      <p>Order: {s.order.reference} · Table {s.order.table}</p>
      <p>Date: {new Date(receipt.issuedAt).toLocaleString("en-IN")}</p>
      <hr className="my-2 border-dashed border-black" />
      {s.items.map((i, idx) => (
        <div key={idx} className="flex justify-between gap-2">
          <span>
            {i.quantity} x {i.name}
            {i.options.length > 0 && <span className="block pl-3 text-[11px]">{i.options.join(", ")}</span>}
          </span>
          <span>{formatMoney(i.lineSubtotalPaise)}</span>
        </div>
      ))}
      <hr className="my-2 border-dashed border-black" />
      <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(s.totals.subtotalPaise)}</span></div>
      {s.totals.discountPaise > 0 && <div className="flex justify-between"><span>Discount</span><span>-{formatMoney(s.totals.discountPaise)}</span></div>}
      {s.totals.taxBreakdown.flatMap((t) => t.components.map((c) => (
        <div key={`${t.code}${c.name}`} className="flex justify-between"><span>{c.name} {c.rateBps / 100}%{s.totals.pricesIncludeTax ? " (incl.)" : ""}</span><span>{formatMoney(c.amountPaise)}</span></div>
      )))}
      {s.totals.roundingPaise !== 0 && <div className="flex justify-between"><span>Rounding</span><span>{formatMoney(s.totals.roundingPaise)}</span></div>}
      <div className="flex justify-between font-bold"><span>TOTAL</span><span>{formatMoney(s.totals.totalPaise)}</span></div>
      {s.bill.adjustmentDiscountPaise > 0 && <div className="flex justify-between"><span>Adjustments</span><span>-{formatMoney(s.bill.adjustmentDiscountPaise)}</span></div>}
      <hr className="my-2 border-dashed border-black" />
      {s.payments.map((p, idx) => (
        <div key={idx} className="flex justify-between"><span>Paid ({p.method.replace("_", " ").toLowerCase()}{p.verified ? "" : ", recorded"})</span><span>{formatMoney(p.amountPaise)}</span></div>
      ))}
      {s.footer && <p className="mt-3 text-center">{s.footer}</p>}
      <p className="mt-2 text-center text-[10px]">Issued by {user.name}</p>
      <PrintButton />
    </main>
  );
}
