import { AdminGate } from "@/components/admin/gate";
import { RewardsAdmin } from "@/components/admin/rewards-admin";

export const metadata = { title: "Rewards" };

export default function RewardsAdminPage() {
  return <AdminGate perms={["settings.manage"]}>{() => <RewardsAdmin />}</AdminGate>;
}
