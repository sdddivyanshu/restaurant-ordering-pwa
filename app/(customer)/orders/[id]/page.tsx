import { CustomerShell, RequireSession } from "@/components/customer/shell";
import { OrderTracker } from "@/components/customer/order-tracker";

export const metadata = { title: "Order status" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CustomerShell>
      <RequireSession>
        <OrderTracker orderId={id} />
      </RequireSession>
    </CustomerShell>
  );
}
