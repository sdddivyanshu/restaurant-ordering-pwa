import { customerRoute } from "@/lib/http/route";
import { changeResponseSchema } from "@/lib/validation/schemas";
import { respondToChange } from "@/lib/approvals/service";

/** POST — accept or decline a supervisor's proposed change. Accepting returns the order for re-approval. */
export const POST = customerRoute({ body: changeResponseSchema }, async ({ customer, params, body }) => {
  const order = await respondToChange(customer, params.id, body.changeRequestId, body.accept);
  return { status: order.status, version: order.version };
});
