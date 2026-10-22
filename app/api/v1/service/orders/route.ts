import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { listReadyToServe } from "@/lib/orders/serve";

export const GET = staffRoute({ permission: [PERMISSIONS.ORDER_SERVE, PERMISSIONS.SERVICE_VIEW] }, async () => ({ orders: await listReadyToServe() }));
