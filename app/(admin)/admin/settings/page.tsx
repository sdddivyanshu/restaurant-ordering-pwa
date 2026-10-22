import { AdminGate } from "@/components/admin/gate";
import { SettingsAdmin } from "@/components/admin/settings-admin";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return <AdminGate perms={["settings.manage"]}>{() => <SettingsAdmin />}</AdminGate>;
}
