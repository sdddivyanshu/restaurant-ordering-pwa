import { requireStaffPage } from "@/lib/auth/page-guard";
import { NoAccess, StaffShell } from "@/components/staff/staff-shell";
import { StaffProviders } from "@/components/staff/providers";
import { CashierBoard } from "@/components/cashier/cashier-board";

export const metadata = { title: "Cashier" };

export default async function CashierPage() {
  const { user, allowed } = await requireStaffPage(["bill.view"]);
  return (
    <StaffProviders>
      <StaffShell user={user}>{allowed ? <CashierBoard canAdjust={user.permissions.includes("payment.adjust")} /> : <NoAccess />}</StaffShell>
    </StaffProviders>
  );
}
