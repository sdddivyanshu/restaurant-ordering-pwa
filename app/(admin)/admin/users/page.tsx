import { AdminGate } from "@/components/admin/gate";
import { UsersAdmin } from "@/components/admin/users-admin";

export const metadata = { title: "Staff & roles" };

export default function UsersPage() {
  return <AdminGate perms={["user.manage"]}>{() => <UsersAdmin />}</AdminGate>;
}
