import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { feedbackResolveSchema } from "@/lib/validation/schemas";
import { resolveFeedback } from "@/lib/feedback/service";

export const POST = staffRoute({ permission: PERMISSIONS.FEEDBACK_RESOLVE, body: feedbackResolveSchema }, async ({ staff, params, body }) => {
  await resolveFeedback(staff, params.id, body.note);
  return { ok: true };
});
