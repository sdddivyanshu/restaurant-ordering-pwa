import { AdminGate } from "@/components/admin/gate";
import { OrdersAdmin } from "@/components/admin/lists-admin";

export const metadata = { title: "Orders" };

export default function OrdersAdminPage() {
  return <AdminGate perms={["order.view"]}>{() => <OrdersAdmin />}</AdminGate>;
}
