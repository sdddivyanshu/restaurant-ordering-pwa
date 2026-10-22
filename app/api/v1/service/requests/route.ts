import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { listStaffRequests } from "@/lib/service-requests/service";

export const GET = staffRoute({ permission: PERMISSIONS.SERVICE_VIEW }, async () => ({ requests: await listStaffRequests() }));
