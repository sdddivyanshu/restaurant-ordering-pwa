import { redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/page-guard";
import { homePathFor } from "@/lib/authorization/permissions";

export default async function StaffHome() {
  const { user } = await requireStaffPage();
  redirect(homePathFor(user.permissions));
}
