import { AdminGate } from "@/components/admin/gate";
import { MenuAdmin } from "@/components/admin/menu-admin";

export const metadata = { title: "Menu" };

export default function MenuAdminPage() {
  return <AdminGate perms={["menu.manage"]}>{() => <MenuAdmin />}</AdminGate>;
}
