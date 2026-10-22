import { requireStaffPage } from "@/lib/auth/page-guard";
import { NoAccess, StaffShell } from "@/components/staff/staff-shell";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";

export const metadata = { title: "Kitchen display" };

export default async function KitchenPage() {
  const { user, allowed } = await requireStaffPage(["kitchen.view"]);
  return (
    <StaffShell user={user} dark>
      {allowed ? <KitchenBoard /> : <NoAccess />}
    </StaffShell>
  );
}
