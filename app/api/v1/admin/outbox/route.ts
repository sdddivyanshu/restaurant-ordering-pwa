import { z } from "zod";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { listOutbox } from "@/lib/admin/config";

export const GET = staffRoute(
  { permission: PERMISSIONS.OUTBOX_MANAGE, query: z.object({ status: z.enum(["PENDING", "PROCESSING", "DONE", "FAILED"]).optional() }) },
  async ({ query }) => listOutbox(query.status),
);
