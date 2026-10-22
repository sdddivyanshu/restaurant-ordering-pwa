import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { retryOutboxEvent } from "@/lib/kitchen/outbox";

/** POST — retry a failed kitchen dispatch. Safe: the handler is idempotent (one ticket per order). */
export const POST = staffRoute({ permission: PERMISSIONS.OUTBOX_MANAGE }, async ({ staff, params }) => ({
  event: await retryOutboxEvent(params.id, { type: "STAFF", id: staff.userId, label: staff.name }),
}));
