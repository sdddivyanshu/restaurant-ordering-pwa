import { AdminGate } from "@/components/admin/gate";
import { DispatchAdmin } from "@/components/admin/lists-admin";

export const metadata = { title: "Kitchen dispatch" };

export default function DispatchPage() {
  return <AdminGate perms={["outbox.manage"]}>{() => <DispatchAdmin />}</AdminGate>;
}
