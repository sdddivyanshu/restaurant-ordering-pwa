import { z } from "zod";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { dateRangeSchema } from "@/lib/validation/schemas";
import { defaultRange, exportCsv } from "@/lib/analytics/service";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/audit";

export const GET = staffRoute(
  { permission: PERMISSIONS.ANALYTICS_VIEW, query: dateRangeSchema.extend({ type: z.enum(["orders", "daily", "items"]).default("daily") }) },
  async ({ query, staff }) => {
    const d = defaultRange();
    const range = { from: query.from ?? d.from, to: query.to ?? d.to, includeDemo: query.includeDemo === "true" };
    const csv = await exportCsv(query.type, range);
    await prisma.$transaction((tx) =>
      audit(tx, { actor: { type: "STAFF", id: staff.userId, label: staff.name }, action: "analytics.exported", entityType: "Report", entityId: query.type, meta: range }),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${query.type}-${range.from}-to-${range.to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  },
);
