import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { adminOverview } from "@/lib/admin/config";

export const GET = staffRoute({ permission: PERMISSIONS.ANALYTICS_VIEW }, async () => adminOverview());
