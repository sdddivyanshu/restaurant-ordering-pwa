import { customerRoute } from "@/lib/http/route";
import { customerCancelSchema } from "@/lib/validation/schemas";
import { cancelOrderByCustomer } from "@/lib/approvals/service";

/** POST — a customer may withdraw an order only while it is still PENDING_APPROVAL. */
export const POST = customerRoute({ body: customerCancelSchema }, async ({ customer, params, body }) => {
  const order = await cancelOrderByCustomer(customer, params.id, body.reason);
  return { status: order.status };
});
