import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { voidPaymentSchema } from "@/lib/validation/schemas";
import { voidPayment } from "@/lib/payments/service";

export const POST = staffRoute({ permission: PERMISSIONS.PAYMENT_ADJUST, body: voidPaymentSchema }, async ({ staff, params, body }) => {
  await voidPayment(staff, params.id, body.reason);
  return { ok: true };
});
