import { customerRoute } from "@/lib/http/route";
import { sseResponse } from "@/lib/notifications/sse";
import { topics } from "@/lib/notifications/bus";

export const dynamic = "force-dynamic";

/** GET — SSE stream scoped to this customer session and table visit (authorised server-side). */
export const GET = customerRoute({}, async ({ customer, req }) =>
  sseResponse(req.signal, [topics.customerSession(customer.sessionId), topics.tableSession(customer.tableSessionId)]),
);
