import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { paginationSchema } from "@/lib/validation/schemas";
import { listAudit } from "@/lib/admin/config";

export const GET = staffRoute({ permission: PERMISSIONS.AUDIT_VIEW, query: paginationSchema }, async ({ query }) => listAudit(query));
