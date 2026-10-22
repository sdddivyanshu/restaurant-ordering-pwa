import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_STAFF } from "@/lib/auth/cookies";
import { resolveStaffSession } from "@/lib/auth/staff-session";
import { homePathFor } from "@/lib/authorization/permissions";
import { LoginForm } from "@/components/staff/login-form";
import { demoAccountsAllowed, isProduction } from "@/lib/env";

export const metadata = { title: "Staff sign in" };

export default async function LoginPage() {
  const staff = await resolveStaffSession((await cookies()).get(COOKIE_STAFF)?.value);
  if (staff) redirect(homePathFor(staff.permissions));
  return <LoginForm showDemoHint={!isProduction() && demoAccountsAllowed()} />;
}
