import { AdminGate } from "@/components/admin/gate";
import { TablesAdmin } from "@/components/admin/tables-admin";

export const metadata = { title: "Tables & QR" };

export default function TablesPage() {
  return <AdminGate perms={["table.manage"]}>{() => <TablesAdmin />}</AdminGate>;
}
