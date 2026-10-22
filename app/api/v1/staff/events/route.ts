import { staffRoute } from "@/lib/http/route";
import { sseResponse } from "@/lib/notifications/sse";
import { topics } from "@/lib/notifications/bus";

export const dynamic = "force-dynamic";

/** GET — SSE for staff dashboards. Events carry only ids/status hints; clients refetch with auth. */
export const GET = staffRoute({ permission: "any-staff" }, async ({ req }) => sseResponse(req.signal, [topics.staff]));
