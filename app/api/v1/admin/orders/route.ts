import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { paginationSchema } from "@/lib/validation/schemas";
import { searchOrders } from "@/lib/admin/config";

export const GET = staffRoute({ permission: [PERMISSIONS.ORDER_VIEW, PERMISSIONS.BILL_VIEW], query: paginationSchema }, async ({ query }) => searchOrders(query));
