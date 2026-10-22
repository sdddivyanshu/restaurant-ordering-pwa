import { NextResponse } from "next/server";
import { staffRoute } from "@/lib/http/route";
import { PERMISSIONS } from "@/lib/authorization/permissions";
import { adjustmentSchema } from "@/lib/validation/schemas";
import { addAdjustment } from "@/lib/payments/service";

/** POST — authorised discount / correction / refund with a mandatory reason (audit-logged). */
export const POST = staffRoute({ permission: PERMISSIONS.PAYMENT_ADJUST, body: adjustmentSchema }, async ({ staff, params, body }) => {
  await addAdjustment(staff, params.id, body);
  return NextResponse.json({ ok: true }, { status: 201 });
});
