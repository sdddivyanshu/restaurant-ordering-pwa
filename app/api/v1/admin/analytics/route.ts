import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { dateRangeSchema } from "@/lib/validation/schemas";
import { defaultRange, getAnalytics } from "@/lib/analytics/service";
import { badRequest } from "@/lib/http/errors";

export const GET = staffRoute({ permission: PERMISSIONS.ANALYTICS_VIEW, query: dateRangeSchema }, async ({ query }) => {
  const d = defaultRange();
  const range = { from: query.from ?? d.from, to: query.to ?? d.to, includeDemo: query.includeDemo === "true" };
  if (range.from > range.to) throw badRequest("'from' must be on or before 'to'");
  return getAnalytics(range);
});
