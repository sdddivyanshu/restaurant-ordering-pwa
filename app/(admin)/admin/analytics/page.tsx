import { AdminGate } from "@/components/admin/gate";
import { AnalyticsAdmin } from "@/components/admin/analytics-admin";

export const metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return <AdminGate perms={["analytics.view"]}>{() => <AnalyticsAdmin />}</AdminGate>;
}
