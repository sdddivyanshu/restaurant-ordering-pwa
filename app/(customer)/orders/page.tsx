import { CustomerShell, RequireSession } from "@/components/customer/shell";
import { OrdersView } from "@/components/customer/orders-view";

export const metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <CustomerShell>
      <RequireSession>
        <OrdersView />
      </RequireSession>
    </CustomerShell>
  );
}
