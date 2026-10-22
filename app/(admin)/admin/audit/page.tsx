import { AdminGate } from "@/components/admin/gate";
import { AuditAdmin } from "@/components/admin/lists-admin";

export const metadata = { title: "Audit log" };

export default function AuditPage() {
  return <AdminGate perms={["audit.view"]}>{() => <AuditAdmin />}</AdminGate>;
}
