import { requireStaffPage } from "@/lib/auth/page-guard";
import { NoAccess, StaffShell } from "@/components/staff/staff-shell";
import { StaffProviders } from "@/components/staff/providers";
import { SupervisorBoard } from "@/components/supervisor/supervisor-board";

export const metadata = { title: "Approvals" };

export default async function SupervisorPage() {
  const { user, allowed } = await requireStaffPage(["order.view", "order.approve"]);
  return (
    <StaffProviders>
      <StaffShell user={user}>{allowed ? <SupervisorBoard permissions={user.permissions} /> : <NoAccess />}</StaffShell>
    </StaffProviders>
  );
}
