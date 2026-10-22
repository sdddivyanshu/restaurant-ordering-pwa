import { NextResponse } from "next/server";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { recordPaymentSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { recordPayment } from "@/lib/payments/service";

/** POST — record money received (manual; never claims gateway verification). Idempotent per key. */
export const POST = staffRoute({ permission: PERMISSIONS.PAYMENT_RECORD, body: recordPaymentSchema, rateLimit: RATE_LIMITS.staffWrite }, async ({ staff, body }) => {
  const { payment, duplicate } = await recordPayment(staff, body);
  return NextResponse.json(
    { payment: { id: payment.id, amountPaise: payment.amountPaise, method: payment.method, providerVerified: payment.providerVerified }, duplicate },
    { status: duplicate ? 200 : 201 },
  );
});
