import { requireStaffPage } from "@/lib/auth/page-guard";
import { NoAccess } from "@/components/staff/staff-shell";
import type { Permission } from "@/lib/authorization/permissions";

/** Per-page permission gate inside the admin area (server component). */
export async function AdminGate({ perms, children }: { perms: Permission[]; children: (p: string[]) => React.ReactNode }) {
  const { user, allowed } = await requireStaffPage(perms);
  return <>{allowed ? children(user.permissions) : <NoAccess />}</>;
}
