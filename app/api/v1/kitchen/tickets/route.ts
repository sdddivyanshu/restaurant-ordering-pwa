import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { getKitchenBoard } from "@/lib/kitchen/service";

/** GET — kitchen board. Built only from dispatched tickets: pending orders cannot appear here. */
export const GET = staffRoute({ permission: PERMISSIONS.KITCHEN_VIEW }, async () => getKitchenBoard());
