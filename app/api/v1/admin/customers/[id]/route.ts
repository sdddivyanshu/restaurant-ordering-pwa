import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { anonymizeCustomer } from "@/lib/customers/service";

/** DELETE — handle a data-deletion request: anonymise personal data, keep required financial records. */
export const DELETE = staffRoute({ permission: PERMISSIONS.CUSTOMER_DATA_MANAGE }, async ({ staff, params }) => {
  await anonymizeCustomer(params.id, staff.userId);
  return { ok: true };
});
