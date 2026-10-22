import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_STAFF } from "@/lib/auth/cookies";
import { resolveStaffSession } from "@/lib/auth/staff-session";
import { hasPermission, type Permission } from "@/lib/authorization/permissions";

/**
 * Server-side guard for staff/admin pages. Redirects to login without a valid session.
 * (UI gating only — every API call is independently authorised on the server.)
 */
export async function requireStaffPage(anyOf: Permission[] | "any" = "any") {
  const token = (await cookies()).get(COOKIE_STAFF)?.value;
  const staff = await resolveStaffSession(token);
  if (!staff) redirect("/staff/login");
  const allowed = anyOf === "any" || anyOf.some((p) => hasPermission(staff.permissions, p));
  return {
    allowed,
    user: { name: staff.name, email: staff.email, roleName: staff.roleName, permissions: [...staff.permissions] },
  };
}

export type StaffPageUser = Awaited<ReturnType<typeof requireStaffPage>>["user"];
