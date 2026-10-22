import { publicRoute } from "@/lib/http/route";
import { qrSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { openTableVisit } from "@/lib/tables/service";
import { getPublicConfig } from "@/lib/settings";

/** POST /api/v1/public/qr — validate a scanned table token and open/join the table visit. */
export const POST = publicRoute({ body: qrSchema, rateLimit: RATE_LIMITS.qr }, async ({ body }) => {
  const visit = await openTableVisit(body.token);
  return { table: { label: visit.table.label, name: visit.table.name }, visitExpiresAt: visit.visit.expiresAt, restaurant: await getPublicConfig() };
});
