import { requireStaffPage } from "@/lib/auth/page-guard";
import { NoAccess, StaffShell } from "@/components/staff/staff-shell";
import { StaffProviders } from "@/components/staff/providers";
import { AdminNav } from "@/components/admin/kit";

export const metadata = { title: { default: "Admin", template: "%s · Admin" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, allowed } = await requireStaffPage(["settings.manage", "analytics.view", "menu.manage", "table.manage", "user.manage", "audit.view", "feedback.view", "outbox.manage"]);
  return (
    <StaffProviders>
      <StaffShell user={user}>
        {allowed ? (
          <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
            <aside className="no-print lg:sticky lg:top-20 lg:self-start">
              <AdminNav permissions={user.permissions} />
            </aside>
            <div className="min-w-0">{children}</div>
          </div>
        ) : (
          <NoAccess />
        )}
      </StaffShell>
    </StaffProviders>
  );
}
