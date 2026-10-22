import { customerRoute } from "@/lib/http/route";
import { cancelRequestByCustomer } from "@/lib/service-requests/service";

/** Customers may cancel their own pending request — they can never mark one completed. */
export const POST = customerRoute({}, async ({ customer, params }) => {
  await cancelRequestByCustomer(customer, params.id);
  return { ok: true };
});
