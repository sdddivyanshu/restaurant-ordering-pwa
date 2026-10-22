import { AdminGate } from "@/components/admin/gate";
import { AdminOverview } from "@/components/admin/overview";

export const metadata = { title: "Overview" };

export default function AdminHome() {
  return <AdminGate perms={["analytics.view"]}>{() => <AdminOverview />}</AdminGate>;
}
