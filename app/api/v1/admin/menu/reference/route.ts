import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { menuReferenceData } from "@/lib/admin/menu";

export const GET = staffRoute({ permission: PERMISSIONS.MENU_MANAGE }, async () => menuReferenceData());
