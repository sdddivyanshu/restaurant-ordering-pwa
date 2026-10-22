import { z } from "zod";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { listFeedback } from "@/lib/feedback/service";

export const GET = staffRoute(
  {
    permission: PERMISSIONS.FEEDBACK_VIEW,
    query: z.object({
      filter: z.enum(["all", "complaints", "unresolved"]).default("all"),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  async ({ query }) => listFeedback(query.filter, query.page, query.pageSize),
);
