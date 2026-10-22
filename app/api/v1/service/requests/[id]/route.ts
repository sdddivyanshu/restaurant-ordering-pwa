import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { serviceActionSchema } from "@/lib/validation/schemas";
import { staffRequestAction } from "@/lib/service-requests/service";

export const POST = staffRoute({ permission: PERMISSIONS.SERVICE_UPDATE, body: serviceActionSchema }, async ({ staff, params, body }) => {
  const r = await staffRequestAction(staff, params.id, body.action);
  return { status: r.status };
});
