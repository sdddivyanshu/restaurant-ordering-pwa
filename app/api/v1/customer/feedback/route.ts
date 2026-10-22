import { NextResponse } from "next/server";
import { customerRoute } from "@/lib/http/route";
import { feedbackSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { submitFeedback } from "@/lib/feedback/service";

export const POST = customerRoute({ body: feedbackSchema, rateLimit: RATE_LIMITS.feedback }, async ({ customer, body }) => {
  const fb = await submitFeedback(customer, body);
  return NextResponse.json({ id: fb.id }, { status: 201 });
});
