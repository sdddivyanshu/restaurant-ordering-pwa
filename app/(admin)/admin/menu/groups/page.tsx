import { AdminGate } from "@/components/admin/gate";
import { GroupsAdmin } from "@/components/admin/groups-admin";

export const metadata = { title: "Customizations" };

export default function GroupsPage() {
  return <AdminGate perms={["menu.manage"]}>{() => <GroupsAdmin />}</AdminGate>;
}
