import { requireStaffPage } from "@/lib/auth/page-guard";
import { NoAccess, StaffShell } from "@/components/staff/staff-shell";
import { ServiceBoard } from "@/components/service/service-board";

export const metadata = { title: "Service" };

export default async function ServicePage() {
  const { user, allowed } = await requireStaffPage(["service.view"]);
  return <StaffShell user={user}>{allowed ? <ServiceBoard canServe={user.permissions.includes("order.serve")} /> : <NoAccess />}</StaffShell>;
}
