import { staffRoute } from "@/lib/http/route";
import { homePathFor } from "@/lib/authorization/permissions";

export const GET = staffRoute({ permission: "any-staff" }, async ({ staff }) => ({
  user: { name: staff.name, email: staff.email, role: staff.roleKey, roleName: staff.roleName, permissions: [...staff.permissions] },
  home: homePathFor(staff.permissions),
}));
